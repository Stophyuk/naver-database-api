import { initDb, getDb } from "./db/init";
import { analyzeOpportunity } from "./analysis/opportunity";

async function runAnalysis() {
  console.log("🔬 분석 시작:", new Date().toISOString());

  initDb();

  // analysis_results 테이블 생성
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      score REAL,
      data TEXT,
      analyzed_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_type ON analysis_results(analysis_type, analyzed_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_keyword ON analysis_results(keyword, analysis_type);
  `);

  // 이전 분석 결과 정리 (최근 7일만 유지)
  db.prepare(`DELETE FROM analysis_results WHERE analyzed_at < datetime('now', '-7 days')`).run();
  db.close();

  // opportunity 분석이 blue-ocean과 trending을 내부적으로 호출
  const results = await analyzeOpportunity();

  // 결과 요약
  console.log("\n📊 분석 결과 요약:");
  console.log(`  총 ${results.length}개 키워드 분석`);

  console.log("\n🏆 기회 점수 TOP 10:");
  for (const r of results.slice(0, 10)) {
    console.log(`  ${r.keyword}: ${r.opportunityScore}점 (${r.trendDirection}) → ${r.suggestedContentType}`);
  }

  console.log("\n✅ 분석 완료:", new Date().toISOString());
}

runAnalysis().catch(err => {
  console.error("❌ 분석 실패:", err);
  process.exit(1);
});
