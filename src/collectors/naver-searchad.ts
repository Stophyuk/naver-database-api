import crypto from "crypto";
import { config } from "../config";
import { getDb } from "../db/init";

function generateSignature(timestamp: number, method: string, path: string): string {
  const message = `${timestamp}.${method}.${path}`;
  return crypto
    .createHmac("sha256", config.naverSearchAd.secret)
    .update(message)
    .digest("base64");
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[<>≤≥\s,]/g, ""), 10);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function parseFloat2(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[<>≤≥\s,]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

interface KwData {
  relKeyword: string;
  monthlyPcQcCnt: unknown;
  monthlyMobileQcCnt: unknown;
  monthlyAvePcClkCnt: unknown;
  monthlyAveMobileClkCnt: unknown;
  monthlyAvePcCtr: unknown;
  monthlyAveMobileCtr: unknown;
  plAvgDepth: unknown;
  compIdx: string;
}

async function fetchKeywordStats(keywords: string[]): Promise<KwData[]> {
  const path = "/keywordstool";
  const timestamp = Date.now();
  const method = "GET";
  const sig = generateSignature(timestamp, method, path);

  const url = `https://api.searchad.naver.com${path}?hintKeywords=${encodeURIComponent(keywords.join(","))}&showDetail=1`;

  const res = await fetch(url, {
    headers: {
      "X-Timestamp": String(timestamp),
      "X-API-KEY": config.naverSearchAd.license,
      "X-Customer": config.naverSearchAd.customerId,
      "X-Signature": sig,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SearchAd API ${res.status}: ${body}`);
  }

  const data = await res.json() as { keywordList: KwData[] };
  return data.keywordList || [];
}

export async function collectNaverSearchAd(): Promise<{ apiCalls: number; rowsInserted: number }> {
  const db = getDb();
  const trackedRows = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1"
  ).all() as { keyword_group: string; keywords: string }[];

  const allKeywords: string[] = [];
  for (const row of trackedRows) {
    const kws = JSON.parse(row.keywords) as string[];
    allKeywords.push(...kws);
  }

  if (allKeywords.length === 0) {
    db.close();
    console.log("⚠️ 추적 키워드 없음 — SearchAd 건너뜀");
    return { apiCalls: 0, rowsInserted: 0 };
  }

  // Batch in groups of 5
  const batches: string[][] = [];
  for (let i = 0; i < allKeywords.length; i += 5) {
    batches.push(allKeywords.slice(i, i + 5));
  }

  const now = new Date().toISOString();
  let totalRows = 0;

  const stmtKw = db.prepare(
    `INSERT INTO keyword_stats (keyword, monthly_pc_cnt, monthly_mobile_cnt, monthly_pc_clk, monthly_mobile_clk, monthly_pc_ctr, monthly_mobile_ctr, pl_avg_depth, comp_idx, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const stmtRel = db.prepare(
    `INSERT INTO related_keywords (seed_keyword, related_keyword, monthly_pc_cnt, monthly_mobile_cnt, comp_idx, collected_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const batch of batches) {
    try {
      const results = await fetchKeywordStats(batch);

      const insertBatch = db.transaction((items: KwData[]) => {
        for (const item of items) {
          const isSeed = batch.includes(item.relKeyword);
          if (isSeed) {
            stmtKw.run(
              item.relKeyword,
              parseNum(item.monthlyPcQcCnt),
              parseNum(item.monthlyMobileQcCnt),
              parseFloat2(item.monthlyAvePcClkCnt),
              parseFloat2(item.monthlyAveMobileClkCnt),
              parseFloat2(item.monthlyAvePcCtr),
              parseFloat2(item.monthlyAveMobileCtr),
              parseFloat2(item.plAvgDepth),
              item.compIdx || null,
              now
            );
          } else {
            // Related keyword — find closest seed
            const seed = batch[0];
            stmtRel.run(
              seed,
              item.relKeyword,
              parseNum(item.monthlyPcQcCnt),
              parseNum(item.monthlyMobileQcCnt),
              item.compIdx || null,
              now
            );
          }
          totalRows++;
        }
      });

      insertBatch(results);

      // Rate limit
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`⚠️ SearchAd batch 실패 [${batch.join(",")}]:`, err);
    }
  }

  db.close();
  console.log(`🔍 SearchAd: ${totalRows}개 키워드 통계 수집`);
  return { apiCalls: batches.length, rowsInserted: totalRows };
}

if (require.main === module) {
  collectNaverSearchAd()
    .then((r) => console.log("✅ 완료:", r))
    .catch((e) => console.error("❌ 실패:", e));
}
