import { getDb } from "../db/init";

async function fetchSuggestions(query: string): Promise<string[]> {
  const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(query)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Suggest API ${res.status}`);

  const data = await res.json() as { items: string[][][] };
  // items[0] contains arrays of [keyword, ...]
  const suggestions: string[] = [];
  if (data.items?.[0]) {
    for (const item of data.items[0]) {
      if (item[0]) suggestions.push(item[0]);
    }
  }
  return suggestions;
}

export async function collectNaverSuggest(): Promise<{ apiCalls: number; rowsInserted: number }> {
  const db = getDb();
  const trackedRows = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1"
  ).all() as { keyword_group: string; keywords: string }[];

  const allKeywords: string[] = [];
  for (const row of trackedRows) {
    allKeywords.push(...(JSON.parse(row.keywords) as string[]));
  }

  if (allKeywords.length === 0) {
    db.close();
    return { apiCalls: 0, rowsInserted: 0 };
  }

  const now = new Date().toISOString();
  let totalRows = 0;
  let apiCalls = 0;

  const stmt = db.prepare(
    `INSERT INTO naver_suggestions (seed_keyword, suggestion, rank, collected_at)
     VALUES (?, ?, ?, ?)`
  );

  for (const kw of allKeywords) {
    try {
      const suggestions = await fetchSuggestions(kw);
      apiCalls++;

      const insert = db.transaction((items: string[]) => {
        items.forEach((s, i) => {
          stmt.run(kw, s, i + 1, now);
          totalRows++;
        });
      });
      insert(suggestions);

      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`⚠️ Suggest 실패 [${kw}]:`, err);
    }
  }

  db.close();
  console.log(`💡 Suggest: ${totalRows}개 자동완성 수집`);
  return { apiCalls, rowsInserted: totalRows };
}

if (require.main === module) {
  collectNaverSuggest()
    .then((r) => console.log("✅ 완료:", r))
    .catch((e) => console.error("❌ 실패:", e));
}
