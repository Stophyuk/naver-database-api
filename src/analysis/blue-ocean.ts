import { getDb } from "../db/init";

export interface BlueOceanResult {
  keyword: string;
  searchVolume: number;
  blogCount: number;
  competition: string;
  blueOceanScore: number;
  rank: number;
}

const COMPETITION_WEIGHT: Record<string, number> = {
  "낮음": 3,
  "중간": 1.5,
  "높음": 0.5,
};

export async function analyzeBlueOcean(): Promise<BlueOceanResult[]> {
  const db = getDb();

  // 최신 keyword_stats에서 검색량과 경쟁도 가져오기
  const stats = db.prepare(`
    SELECT ks.keyword, ks.monthly_mobile_cnt, ks.comp_idx,
           COALESCE(sv.total_results, 0) as blog_count
    FROM keyword_stats ks
    LEFT JOIN (
      SELECT keyword, total_results,
             ROW_NUMBER() OVER (PARTITION BY keyword ORDER BY collected_at DESC) as rn
      FROM naver_search_volume
      WHERE search_type = 'blog'
    ) sv ON sv.keyword = ks.keyword AND sv.rn = 1
    WHERE ks.id IN (
      SELECT MAX(id) FROM keyword_stats GROUP BY keyword
    )
    AND ks.monthly_mobile_cnt > 0
    ORDER BY ks.monthly_mobile_cnt DESC
  `).all() as any[];

  if (stats.length === 0) {
    // keyword_stats가 없으면 related_keywords에서 대체
    const altStats = db.prepare(`
      SELECT rk.related_keyword as keyword,
             MAX(rk.monthly_mobile_cnt) as monthly_mobile_cnt,
             MAX(rk.comp_idx) as comp_idx,
             COALESCE(sv.total_results, 0) as blog_count
      FROM related_keywords rk
      LEFT JOIN (
        SELECT keyword, total_results,
               ROW_NUMBER() OVER (PARTITION BY keyword ORDER BY collected_at DESC) as rn
        FROM naver_search_volume
        WHERE search_type = 'blog'
      ) sv ON sv.keyword = rk.related_keyword AND sv.rn = 1
      GROUP BY rk.related_keyword
      HAVING monthly_mobile_cnt > 0
      ORDER BY monthly_mobile_cnt DESC
    `).all() as any[];

    return computeScores(db, altStats);
  }

  return computeScores(db, stats);
}

function computeScores(db: any, stats: any[]): BlueOceanResult[] {
  const maxMobile = stats.length > 0 ? stats[0].monthly_mobile_cnt : 1;

  const results: BlueOceanResult[] = stats.map((s, i) => {
    const compWeight = COMPETITION_WEIGHT[s.comp_idx] || 1;
    const opportunityRatio = s.monthly_mobile_cnt / Math.max(s.blog_count, 1);
    const normalizedVolume = (s.monthly_mobile_cnt / maxMobile) * 100;
    const score = normalizedVolume * compWeight * Math.min(opportunityRatio, 100) / 100;

    return {
      keyword: s.keyword,
      searchVolume: s.monthly_mobile_cnt,
      blogCount: s.blog_count,
      competition: s.comp_idx || "없음",
      blueOceanScore: Math.round(score * 100) / 100,
      rank: 0,
    };
  });

  // 점수로 정렬하고 순위 부여
  results.sort((a, b) => b.blueOceanScore - a.blueOceanScore);
  results.forEach((r, i) => r.rank = i + 1);

  // 저장
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO analysis_results (keyword, analysis_type, score, data, analyzed_at)
    VALUES (?, 'blue_ocean', ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    for (const r of results.slice(0, 500)) {
      stmt.run(r.keyword, r.blueOceanScore, JSON.stringify(r), now);
    }
  });
  saveAll();

  console.log(`🔵 블루오션 분석: ${results.length}개 키워드 분석 완료`);
  db.close();
  return results;
}
