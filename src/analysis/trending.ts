import { getDb } from "../db/init";

export interface TrendingResult {
  keyword: string;
  currentAvg: number;
  previousAvg: number;
  changeRate: number;
  direction: "rising" | "falling" | "stable";
}

export async function analyzeTrending(days: number = 7): Promise<TrendingResult[]> {
  const db = getDb();
  const now = new Date();
  const currentStart = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const previousStart = new Date(now.getTime() - days * 2 * 86400000).toISOString().slice(0, 10);
  const previousEnd = currentStart;

  // search_trends에서 최근 vs 이전 비교
  const trendData = db.prepare(`
    SELECT keyword_group,
      AVG(CASE WHEN period >= ? THEN ratio END) as current_avg,
      AVG(CASE WHEN period >= ? AND period < ? THEN ratio END) as previous_avg
    FROM search_trends
    WHERE period >= ?
    GROUP BY keyword_group
    HAVING current_avg IS NOT NULL AND previous_avg IS NOT NULL AND previous_avg > 0
  `).all(currentStart, previousStart, currentStart, previousStart) as any[];

  // naver_search_volume에서 검색결과수 변화 추가
  const volumeChanges = db.prepare(`
    WITH latest AS (
      SELECT keyword, total_results,
             ROW_NUMBER() OVER (PARTITION BY keyword ORDER BY collected_at DESC) as rn
      FROM naver_search_volume WHERE search_type = 'blog'
    ),
    previous AS (
      SELECT keyword, total_results,
             ROW_NUMBER() OVER (PARTITION BY keyword ORDER BY collected_at DESC) as rn
      FROM naver_search_volume
      WHERE search_type = 'blog' AND collected_at < date('now', '-1 day')
    )
    SELECT l.keyword, l.total_results as current_vol, p.total_results as prev_vol
    FROM latest l
    JOIN previous p ON l.keyword = p.keyword AND p.rn = 1
    WHERE l.rn = 1 AND p.total_results > 0
  `).all() as any[];

  const results: TrendingResult[] = [];

  // 트렌드 기반 결과
  for (const t of trendData) {
    const rate = t.current_avg / t.previous_avg;
    results.push({
      keyword: t.keyword_group,
      currentAvg: Math.round(t.current_avg * 100) / 100,
      previousAvg: Math.round(t.previous_avg * 100) / 100,
      changeRate: Math.round(rate * 100) / 100,
      direction: rate >= 1.2 ? "rising" : rate <= 0.8 ? "falling" : "stable",
    });
  }

  // 검색결과수 기반 결과 (트렌드에 없는 키워드)
  const existingKws = new Set(results.map(r => r.keyword));
  for (const v of volumeChanges) {
    if (existingKws.has(v.keyword)) continue;
    const rate = v.current_vol / v.prev_vol;
    if (Math.abs(rate - 1) < 0.1) continue; // 10% 미만 변화 무시
    results.push({
      keyword: v.keyword,
      currentAvg: v.current_vol,
      previousAvg: v.prev_vol,
      changeRate: Math.round(rate * 100) / 100,
      direction: rate >= 1.2 ? "rising" : rate <= 0.8 ? "falling" : "stable",
    });
  }

  // 변화율 순 정렬
  results.sort((a, b) => Math.abs(b.changeRate - 1) - Math.abs(a.changeRate - 1));

  // 저장
  const saveNow = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO analysis_results (keyword, analysis_type, score, data, analyzed_at)
    VALUES (?, 'trending', ?, ?, ?)
  `);
  const saveAll = db.transaction(() => {
    for (const r of results.slice(0, 200)) {
      stmt.run(r.keyword, r.changeRate, JSON.stringify(r), saveNow);
    }
  });
  saveAll();

  console.log(`📈 트렌드 분석: ${results.length}개 (상승: ${results.filter(r => r.direction === "rising").length}, 하락: ${results.filter(r => r.direction === "falling").length})`);
  db.close();
  return results;
}
