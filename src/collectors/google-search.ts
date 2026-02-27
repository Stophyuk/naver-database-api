import { config } from "../config";
import { getDb } from "../db/init";

async function fetchGoogleTotal(keyword: string): Promise<number> {
  const url = `https://www.googleapis.com/customsearch/v1?key=${config.google.apiKey}&cx=${config.google.cx}&q=${encodeURIComponent(keyword)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google CSE API ${res.status}`);
  const data = await res.json() as { searchInformation?: { totalResults?: string } };
  return parseInt(data.searchInformation?.totalResults || "0", 10);
}

export async function collectGoogleSearch(): Promise<{ apiCalls: number; rowsInserted: number }> {
  const db = getDb();
  const trackedRows = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1"
  ).all() as { keyword_group: string; keywords: string }[];

  const allKeywords: string[] = [];
  for (const row of trackedRows) {
    allKeywords.push(...(JSON.parse(row.keywords) as string[]));
  }

  // Google CSE: 100 queries/day free limit
  const maxQueries = 100;
  const keywords = allKeywords.slice(0, maxQueries);

  if (keywords.length === 0) {
    db.close();
    return { apiCalls: 0, rowsInserted: 0 };
  }

  const now = new Date().toISOString();
  let totalRows = 0;
  let apiCalls = 0;

  const stmt = db.prepare(
    `INSERT INTO google_search_stats (keyword, total_results, collected_at)
     VALUES (?, ?, ?)`
  );

  for (const kw of keywords) {
    try {
      const total = await fetchGoogleTotal(kw);
      apiCalls++;
      stmt.run(kw, total, now);
      totalRows++;
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`⚠️ Google CSE 실패 [${kw}]:`, err);
    }
  }

  db.close();
  console.log(`🌐 Google CSE: ${totalRows}개 수집`);
  return { apiCalls, rowsInserted: totalRows };
}

if (require.main === module) {
  collectGoogleSearch()
    .then((r) => console.log("✅ 완료:", r))
    .catch((e) => console.error("❌ 실패:", e));
}
