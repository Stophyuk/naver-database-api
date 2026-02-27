import { config } from "../config";
import { getDb } from "../db/init";

const SEARCH_TYPES = ["blog", "news", "shop", "cafearticle", "kin"] as const;

async function fetchSearchTotal(keyword: string, type: string): Promise<number> {
  const url = `https://openapi.naver.com/v1/search/${type}?query=${encodeURIComponent(keyword)}&display=1`;
  const res = await fetch(url, {
    headers: {
      "X-Naver-Client-Id": config.naver.clientId,
      "X-Naver-Client-Secret": config.naver.clientSecret,
    },
  });
  if (!res.ok) throw new Error(`Naver Search API ${res.status}`);
  const data = await res.json() as { total: number };
  return data.total || 0;
}

export async function collectNaverSearchVolume(): Promise<{ apiCalls: number; rowsInserted: number }> {
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
    `INSERT INTO naver_search_volume (keyword, search_type, total_results, collected_at)
     VALUES (?, ?, ?, ?)`
  );

  for (const kw of allKeywords) {
    for (const type of SEARCH_TYPES) {
      try {
        const total = await fetchSearchTotal(kw, type);
        apiCalls++;
        stmt.run(kw, type, total, now);
        totalRows++;
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        console.error(`⚠️ SearchVolume 실패 [${kw}/${type}]:`, err);
      }
    }
  }

  db.close();
  console.log(`📊 SearchVolume: ${totalRows}개 수집`);
  return { apiCalls, rowsInserted: totalRows };
}

if (require.main === module) {
  collectNaverSearchVolume()
    .then((r) => console.log("✅ 완료:", r))
    .catch((e) => console.error("❌ 실패:", e));
}
