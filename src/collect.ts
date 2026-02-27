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

  const keywords = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1"
  ).all() as { keyword_group: string; keywords: string }[];

  const categories = db.prepare(
    "SELECT category_name, category_code FROM tracked_categories WHERE active = 1"
  ).all() as { category_name: string; category_code: string }[];

  db.close();

  // 1. 기존: 검색어 트렌드
  if (keywords.length > 0) {
    const keywordGroups = keywords.map((k) => ({
      groupName: k.keyword_group,
      keywords: JSON.parse(k.keywords) as string[],
    }));
    console.log(`\n📊 검색어 트렌드 수집 (${keywordGroups.length}개 그룹)`);
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

  console.log("\n🔍 SearchAd 키워드 통계 수집");
  await logCollection("naver-searchad", collectNaverSearchAd);

  console.log("\n💡 네이버 자동완성 수집");
  await logCollection("naver-suggest", collectNaverSuggest);

  console.log("\n📊 네이버 검색결과수 수집");
  await logCollection("naver-search-volume", collectNaverSearchVolume);

  // Google CSE — 비활성화 (403 이슈, 나중에 해결 후 활성화)
  // console.log("\n🌐 Google CSE 수집");
  // await logCollection("google-search", collectGoogleSearch);

  console.log("\n✅ 전체 수집 완료:", new Date().toISOString());
}

runCollection().catch((err) => {
  console.error("❌ 수집 실패:", err);
  process.exit(1);
});
