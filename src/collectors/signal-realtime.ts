import { getDb } from "../db/init";

interface SignalResponse {
  top10: Array<{
    rank: number;
    keyword: string;
    state: string;
  }>;
}

async function fetchSignalTrends(): Promise<SignalResponse["top10"]> {
  const res = await fetch("https://api.signal.bz/news/realtime", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!res.ok) throw new Error(`Signal.bz API failed: ${res.status}`);

  const data = (await res.json()) as SignalResponse;
  return data.top10 || [];
}

export async function collectSignalRealtime(): Promise<{ apiCalls: number; rowsInserted: number }> {
  const items = await fetchSignalTrends();
  const now = new Date().toISOString();
  const db = getDb();

  const stmt = db.prepare(
    `INSERT INTO realtime_rankings (source, keyword, rank, category, metadata, collected_at)
     VALUES ('signal', ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((rows: typeof items) => {
    for (const item of rows) {
      stmt.run(
        item.keyword,
        item.rank,
        null,
        JSON.stringify({ state: item.state }),
        now
      );
    }
  });

  insertMany(items);
  db.close();

  console.log(`📡 Signal.bz: ${items.length}개 키워드 수집`);
  return { apiCalls: 1, rowsInserted: items.length };
}

if (require.main === module) {
  collectSignalRealtime()
    .then((r) => console.log("✅ 완료:", r))
    .catch((e) => console.error("❌ 실패:", e));
}
