import { getDb } from "../db/init";

export interface VerdictResult {
  keyword: string;
  verdict: "GO" | "CAUTION" | "AVOID";
  ranking: string;
  strategy: string;
  impact: string;
  estimatedMonthlyTraffic: number;
  analyzedAt: string;
}

export async function generateVerdicts(): Promise<VerdictResult[]> {
  const db = getDb();
  const now = new Date().toISOString();

  // 최신 분석 결과 가져오기
  const blueOceanRows = db.prepare(`
    SELECT keyword, score, data FROM analysis_results
    WHERE analysis_type = 'blue_ocean'
      AND analyzed_at = (SELECT MAX(analyzed_at) FROM analysis_results WHERE analysis_type = 'blue_ocean')
  `).all() as any[];

  const trendingRows = db.prepare(`
    SELECT keyword, score, data FROM analysis_results
    WHERE analysis_type = 'trending'
      AND analyzed_at = (SELECT MAX(analyzed_at) FROM analysis_results WHERE analysis_type = 'trending')
  `).all() as any[];

  const trendMap = new Map<string, any>();
  for (const t of trendingRows) {
    trendMap.set(t.keyword, JSON.parse(t.data));
  }

  // keyword_stats 최신
  const statsRows = db.prepare(`
    SELECT * FROM keyword_stats
    WHERE id IN (SELECT MAX(id) FROM keyword_stats GROUP BY keyword)
  `).all() as any[];
  const statsMap = new Map<string, any>();
  for (const s of statsRows) statsMap.set(s.keyword, s);

  // naver_search_volume 최신 (blog)
  const volRows = db.prepare(`
    SELECT keyword, search_type, total_results FROM naver_search_volume
    WHERE id IN (
      SELECT MAX(id) FROM naver_search_volume GROUP BY keyword, search_type
    )
  `).all() as any[];
  const volMap = new Map<string, Map<string, number>>();
  for (const v of volRows) {
    if (!volMap.has(v.keyword)) volMap.set(v.keyword, new Map());
    volMap.get(v.keyword)!.set(v.search_type, v.total_results);
  }

  const results: VerdictResult[] = [];

  for (const bo of blueOceanRows) {
    const boData = JSON.parse(bo.data);
    const keyword = bo.keyword;
    const blueOceanScore = bo.score;
    const stats = statsMap.get(keyword);
    const trend = trendMap.get(keyword);
    const volumes = volMap.get(keyword);

    if (!stats) continue;

    const monthlyTotal = (stats.monthly_pc_cnt || 0) + (stats.monthly_mobile_cnt || 0);
    const monthlyClicks = (stats.monthly_pc_clk || 0) + (stats.monthly_mobile_clk || 0);
    const compIdx = stats.comp_idx || "없음";
    const mobileRatio = monthlyTotal > 0
      ? Math.round(((stats.monthly_mobile_cnt || 0) / monthlyTotal) * 100)
      : 0;
    const blogCount = volumes?.get("blog") || 0;

    // Verdict 판정
    let verdict: "GO" | "CAUTION" | "AVOID";
    const isLowComp = compIdx === "낮음" || compIdx === "중간";

    if (blueOceanScore >= 70 && isLowComp && monthlyTotal >= 1000) {
      verdict = "GO";
    } else if (blueOceanScore < 40 || monthlyTotal < 100) {
      verdict = "AVOID";
    } else {
      verdict = "CAUTION";
    }

    // 예상 트래픽 (상위 3위 가정: 클릭 * 15%)
    const estimatedMonthlyTraffic = Math.round(monthlyClicks * 0.15);

    // 트렌드 방향
    const trendDir = trend?.direction || "stable";
    const trendLabel = trendDir === "rising" ? "상승" : trendDir === "falling" ? "하락" : "안정";

    // ranking 텍스트
    const ranking = `월 ${monthlyTotal.toLocaleString()} 검색, 경쟁도 ${compIdx}, 블루오션 점수 ${Math.round(blueOceanScore)}점. ${
      verdict === "GO" ? "충분한 검색량 대비 경쟁이 적정 수준."
        : verdict === "AVOID" ? "검색량 또는 기회 점수가 낮아 투자 대비 효율이 부족."
        : "경쟁이 치열하거나 기회 점수가 중간 수준. 차별화 필요."
    }`;

    // strategy 텍스트
    const strategyParts: string[] = [];
    strategyParts.push(`모바일 비중 ${mobileRatio}%, ${trendLabel} 트렌드.`);
    if (blogCount > 0) {
      strategyParts.push(`블로그 경쟁 ${blogCount.toLocaleString()}건${blogCount < 5000 ? " — 진입 여지 있음." : " — 차별화된 앵글 필요."}`);
    }
    if (verdict === "GO") {
      strategyParts.push("정보성 콘텐츠로 빠른 진입 추천.");
    } else if (verdict === "CAUTION") {
      strategyParts.push("틈새 앵글(초보자 가이드, 비교 리뷰 등)로 차별화 추천.");
    } else {
      strategyParts.push("다른 키워드 우선 공략 후 재검토 추천.");
    }
    const strategy = strategyParts.join(" ");

    // impact 텍스트
    const impact = estimatedMonthlyTraffic > 0
      ? `상위 3위 진입 시 월 약 ${estimatedMonthlyTraffic.toLocaleString()}명 유입 예상. ${
          trendDir === "rising" ? "상승 트렌드로 성장 가능성 높음." : "꾸준한 검색량으로 장기 트래픽원 가능."
        }`
      : "클릭 데이터 부족으로 유입 예측 어려움. 소규모 테스트 추천.";

    results.push({
      keyword,
      verdict,
      ranking,
      strategy,
      impact,
      estimatedMonthlyTraffic,
      analyzedAt: now,
    });
  }

  // DB 저장
  const stmt = db.prepare(`
    INSERT INTO analysis_results (keyword, analysis_type, score, data, analyzed_at)
    VALUES (?, 'verdict', ?, ?, ?)
  `);
  const saveAll = db.transaction(() => {
    for (const r of results) {
      const score = r.verdict === "GO" ? 3 : r.verdict === "CAUTION" ? 2 : 1;
      stmt.run(r.keyword, score, JSON.stringify(r), now);
    }
  });
  saveAll();

  console.log(`⚖️ Verdict 분석: ${results.length}개 (GO: ${results.filter(r => r.verdict === "GO").length}, CAUTION: ${results.filter(r => r.verdict === "CAUTION").length}, AVOID: ${results.filter(r => r.verdict === "AVOID").length})`);
  db.close();
  return results;
}
