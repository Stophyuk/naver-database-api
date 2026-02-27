import { getDb } from "../db/init";
import { analyzeBlueOcean, BlueOceanResult } from "./blue-ocean";
import { analyzeTrending, TrendingResult } from "./trending";

export interface OpportunityResult {
  keyword: string;
  blueOceanScore: number;
  trendDirection: string;
  opportunityScore: number;
  suggestedContentType: "blog" | "youtube" | "both";
  reason: string;
}

const TREND_WEIGHT: Record<string, number> = {
  rising: 1.5,
  stable: 1.0,
  falling: 0.5,
};

export async function analyzeOpportunity(): Promise<OpportunityResult[]> {
  // 먼저 블루오션과 트렌드 분석 실행
  const blueOceanResults = await analyzeBlueOcean();
  const trendingResults = await analyzeTrending();

  const trendMap = new Map<string, TrendingResult>();
  for (const t of trendingResults) {
    trendMap.set(t.keyword, t);
  }

  const results: OpportunityResult[] = [];

  for (const bo of blueOceanResults) {
    const trend = trendMap.get(bo.keyword);
    const direction = trend?.direction || "stable";
    const trendWeight = TREND_WEIGHT[direction] || 1.0;
    const oppScore = Math.round(bo.blueOceanScore * trendWeight * 100) / 100;

    let contentType: "blog" | "youtube" | "both";
    let reason: string;

    if (bo.blogCount < 1000 && bo.searchVolume > 10000) {
      contentType = "blog";
      reason = `블로그 콘텐츠 부족 (${bo.blogCount}건), 검색량 높음 (${bo.searchVolume.toLocaleString()})`;
    } else if (bo.searchVolume > 100000) {
      contentType = "youtube";
      reason = `대량 검색 키워드, 영상 콘텐츠 유리 (월 ${bo.searchVolume.toLocaleString()}회)`;
    } else {
      contentType = "both";
      reason = `경쟁도 ${bo.competition}, 검색량 ${bo.searchVolume.toLocaleString()}`;
    }

    if (direction === "rising") {
      reason += " / 📈 상승 트렌드";
    }

    results.push({
      keyword: bo.keyword,
      blueOceanScore: bo.blueOceanScore,
      trendDirection: direction,
      opportunityScore: oppScore,
      suggestedContentType: contentType,
      reason,
    });
  }

  results.sort((a, b) => b.opportunityScore - a.opportunityScore);

  // 저장
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO analysis_results (keyword, analysis_type, score, data, analyzed_at)
    VALUES (?, 'opportunity', ?, ?, ?)
  `);
  const saveAll = db.transaction(() => {
    for (const r of results.slice(0, 500)) {
      stmt.run(r.keyword, r.opportunityScore, JSON.stringify(r), now);
    }
  });
  saveAll();

  console.log(`🎯 기회 분석: TOP ${Math.min(results.length, 500)}개 저장`);
  db.close();
  return results;
}
