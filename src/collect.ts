import { initDb, getDb } from "./db/init";
import { collectSearchTrends } from "./collectors/search-trend";
import { collectShoppingInsights } from "./collectors/shopping-insight";
import { collectSignalRealtime } from "./collectors/signal-realtime";
import { collectNaverSearchAd } from "./collectors/naver-searchad";
import { collectNaverSuggest } from "./collectors/naver-suggest";
import { collectNaverSearchVolume } from "./collectors/naver-search-volume";
import { collectGoogleSearch } from "./collectors/google-search";

interface CollectorResult {
  apiCalls: number;
  rowsInserted: number;
}

function withTimeout<T>(fn: () => Promise<T>, ms: number, label: string): () => Promise<T> {
  return () => Promise.race([
    fn(),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} 타임아웃 (${ms/1000}초)`)), ms))
  ]);
}

async function logCollection(
  jobType: string,
  fn: () => Promise<CollectorResult>
): Promise<void> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const db = getDb();

  try {
    const result = await fn();
    const duration = Date.now() - start;
    db.prepare(
      `INSERT INTO collection_logs (job_type, status, api_calls, rows_inserted, duration_ms, started_at, completed_at)
       VALUES (?, 'success', ?, ?, ?, ?, ?)`
    ).run(jobType, result.apiCalls, result.rowsInserted, duration, startedAt, new Date().toISOString());
  } catch (err: any) {
    const duration = Date.now() - start;
    db.prepare(
      `INSERT INTO collection_logs (job_type, status, error_message, duration_ms, started_at, completed_at)
       VALUES (?, 'error', ?, ?, ?, ?)`
    ).run(jobType, err?.message || String(err), duration, startedAt, new Date().toISOString());
    console.error(`❌ ${jobType} 실패:`, err);
  } finally {
    db.close();
  }
}

async function runCollection() {
  console.log("🔄 수집 시작:", new Date().toISOString());

  initDb();
  const db = getDb();

  // 데이터랩 트렌드: 기존 키워드만 (source != 'expanded')
  const originalKeywords = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1 AND (source IS NULL OR source != 'expanded')"
  ).all() as { keyword_group: string; keywords: string }[];

  // 전체 키워드 (기존 + 확장) — 검색결과수, 자동완성, 검색광고용
  const allKeywords = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1"
  ).all() as { keyword_group: string; keywords: string }[];

  const categories = db.prepare(
    "SELECT category_name, category_code FROM tracked_categories WHERE active = 1"
  ).all() as { category_name: string; category_code: string }[];

  db.close();

  // 1. 데이터랩 검색어 트렌드 — 기존 키워드만 (확장 제외)
  if (originalKeywords.length > 0) {
    const keywordGroups = originalKeywords.map((k) => ({
      groupName: k.keyword_group,
      keywords: JSON.parse(k.keywords) as string[],
    }));
    console.log(`\n📊 검색어 트렌드 수집 (기존 ${keywordGroups.length}개 그룹만, 확장 제외)`);
    const fullCombo = keywordGroups.length <= 3;
    await collectSearchTrends(keywordGroups, { fullCombination: fullCombo });
  }

  // 2. 기존: 쇼핑인사이트
  if (categories.length > 0) {
    const cats = categories.map((c) => ({ name: c.category_name, code: c.category_code }));
    console.log(`\n🛒 쇼핑인사이트 수집 (${cats.length}개 카테고리)`);
    await collectShoppingInsights(cats);
  }

  // 3. 신규 수집기들
  console.log("\n📡 Signal.bz 실시간 수집");
  await logCollection("signal-realtime", collectSignalRealtime);

  // 검색광고: 원본 키워드만 (API 한도 보호, 5분 타임아웃)
  console.log(`\n🔍 SearchAd 키워드 통계 수집 (원본 ${originalKeywords.length}개 그룹만)`);
  await logCollection("naver-searchad", withTimeout(() => collectNaverSearchAd({ onlyOriginal: true }), 300000, "SearchAd"));

  // 자동완성: 원본 키워드만 (5분 타임아웃)
  console.log(`\n💡 네이버 자동완성 수집 (원본 ${originalKeywords.length}개 그룹만)`);
  await logCollection("naver-suggest", withTimeout(() => collectNaverSuggest({ onlyOriginal: true }), 300000, "Suggest"));

  // 검색결과수: 원본 키워드만 + 하루 1회 (06:00 KST 실행분만)
  const kstHour = new Date(Date.now() + 9 * 3600000).getUTCHours();
  if (kstHour < 6) {
    // 00:00 KST 실행: 검색결과수 수집 (Naver API 예산 보호)
    console.log(`\n📊 네이버 검색결과수 수집 (원본 ${originalKeywords.length}개 그룹만, 1일1회)`);
    await logCollection("naver-search-volume", withTimeout(() => collectNaverSearchVolume({ onlyOriginal: true }), 600000, "SearchVolume"));
  } else {
    console.log(`\n⏭️ 네이버 검색결과수 — 00:00 KST에만 실행 (API 예산 보호)`);
  }

  // Google CSE — 비활성화 (403 이슈, 나중에 해결 후 활성화)
  // console.log("\n🌐 Google CSE 수집");
  // await logCollection("google-search", collectGoogleSearch);

  // Demographics: 00:00 KST에만 실행 (1일1회, 원본 키워드만)
  if (kstHour < 6) {
    console.log(`\n👥 Demographics 수집 (원본 키워드, 1일1회)`);
    const { collectDemographics } = await import("./collectors/demographics");
    await logCollection("demographics", collectDemographics);
  } else {
    console.log(`\n⏭️ Demographics — 00:00 KST에만 실행`);
  }

  console.log("\n✅ 전체 수집 완료:", new Date().toISOString());

  // 수집 후 분석 실행
  console.log("\n🔬 분석 시작...");
  try {
    const { analyzeOpportunity } = await import("./analysis/opportunity");
    const initDbModule = await import("./db/init");

    // analysis_results 테이블 확보
    const analysisDb = initDbModule.getDb();
    analysisDb.exec(`
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
    analysisDb.prepare(`DELETE FROM analysis_results WHERE analyzed_at < datetime('now', '-7 days')`).run();
    analysisDb.close();

    const results = await analyzeOpportunity();
    console.log(`🔬 분석 완료: ${results.length}개 키워드`);

    // Verdict 생성
    const { generateVerdicts } = await import("./analysis/verdict");
    const verdicts = await generateVerdicts();
    console.log(`⚖️ Verdict 완료: ${verdicts.length}개 키워드`);
  } catch (err) {
    console.error("⚠️ 분석 실패 (수집은 완료):", err);
  }
}

runCollection().catch((err) => {
  console.error("❌ 수집 실패:", err);
  process.exit(1);
});
