import { initDb, getDb } from "./db/init";
import { collectSearchTrends } from "./collectors/search-trend";
import { collectShoppingInsights } from "./collectors/shopping-insight";

/**
 * 전체 수집 실행
 * - tracked_keywords 테이블에서 키워드 로드
 * - tracked_categories 테이블에서 카테고리 로드
 * - 검색어 트렌드 + 쇼핑인사이트 전체 수집
 */
async function runCollection() {
  console.log("🔄 수집 시작:", new Date().toISOString());
  
  initDb();
  const db = getDb();

  // 추적 중인 키워드 로드
  const keywords = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1"
  ).all() as { keyword_group: string; keywords: string }[];

  // 추적 중인 카테고리 로드
  const categories = db.prepare(
    "SELECT category_name, category_code FROM tracked_categories WHERE active = 1"
  ).all() as { category_name: string; category_code: string }[];

  db.close();

  // 검색어 트렌드 수집
  if (keywords.length > 0) {
    const keywordGroups = keywords.map(k => ({
      groupName: k.keyword_group,
      keywords: JSON.parse(k.keywords) as string[],
    }));

    console.log(`\n📊 검색어 트렌드 수집 (${keywordGroups.length}개 그룹)`);
    
    // API 한도 고려: fullCombination은 키워드 그룹 3개 이하일 때만
    const fullCombo = keywordGroups.length <= 3;
    await collectSearchTrends(keywordGroups, { fullCombination: fullCombo });
  } else {
    console.log("⚠️ 추적 중인 키워드 없음 — 검색어 트렌드 건너뜀");
  }

  // 쇼핑인사이트 수집
  if (categories.length > 0) {
    const cats = categories.map(c => ({
      name: c.category_name,
      code: c.category_code,
    }));

    console.log(`\n🛒 쇼핑인사이트 수집 (${cats.length}개 카테고리)`);
    await collectShoppingInsights(cats);
  } else {
    console.log("⚠️ 추적 중인 카테고리 없음 — 쇼핑인사이트 건너뜀");
  }

  console.log("\n✅ 전체 수집 완료:", new Date().toISOString());
}

runCollection().catch((err) => {
  console.error("❌ 수집 실패:", err);
  process.exit(1);
});
