import { NAVER_API, FILTERS } from "../config";
import { callNaverAPI } from "../utils/naver-client";
import { getDb } from "../db/init";

/**
 * 쇼핑인사이트 수집 — 8개 API 엔드포인트 전체
 *
 * 1. 분야별 트렌드 조회 (카테고리 비교)
 * 2. 분야 내 기기별 트렌드
 * 3. 분야 내 성별 트렌드
 * 4. 분야 내 연령별 트렌드
 * 5. 키워드별 트렌드 조회
 * 6. 키워드 기기별 트렌드
 * 7. 키워드 성별 트렌드
 * 8. 키워드 연령별 트렌드
 */

interface CategoryParam {
  name: string;
  param: string[]; // category codes
}

export async function collectShoppingInsights(
  categories: { name: string; code: string }[],
  keywords?: { categoryCode: string; keyword: string }[],
  options?: {
    startDate?: string;
    endDate?: string;
    timeUnit?: string;
  }
) {
  const db = getDb();
  const now = new Date();
  const endDate = options?.endDate || now.toISOString().slice(0, 10);
  const startDate = options?.startDate || new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const timeUnit = options?.timeUnit || "month";

  const job = db.prepare(
    "INSERT INTO collect_jobs (type, status) VALUES ('shopping_insight', 'running')"
  ).run();
  const jobId = job.lastInsertRowid;

  const insertCat = db.prepare(`
    INSERT INTO shopping_category_trends
    (job_id, category, category_code, time_unit, device, gender, ages, start_date, end_date, period, ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertKw = db.prepare(`
    INSERT INTO shopping_keyword_trends
    (job_id, category_code, keyword, time_unit, device, gender, ages, start_date, end_date, period, ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let apiCalls = 0;
  let errors: string[] = [];

  // 1. 분야별 트렌드 (카테고리 3개씩 비교)
  const catChunks = chunkArray(categories, 3);
  for (const chunk of catChunks) {
    try {
      const body = {
        startDate, endDate, timeUnit,
        category: chunk.map(c => ({ name: c.name, param: [c.code] })),
      };
      const data = await callNaverAPI(NAVER_API.shoppingCategory, body);
      apiCalls++;
      saveShoppingCategoryResults(db, insertCat, jobId, data, timeUnit, "", "", "", startDate, endDate);
      console.log(`[쇼핑] 분야별 트렌드 — ${chunk.map(c=>c.name).join(',')} ✓`);
    } catch (err: any) {
      errors.push(err.message);
      console.error(`[쇼핑] 오류: ${err.message}`);
    }
  }

  // 2~4. 분야별 기기/성별/연령 트렌드 (카테고리 1개씩)
  for (const cat of categories) {
    // 기기별
    try {
      const data = await callNaverAPI(NAVER_API.shoppingCategoryDevice, {
        startDate, endDate, timeUnit,
        category: cat.code,
      });
      apiCalls++;
      saveShoppingCategoryResults(db, insertCat, jobId, data, timeUnit, "by_device", "", "", startDate, endDate);
      console.log(`[쇼핑] ${cat.name} 기기별 ✓`);
    } catch (err: any) { errors.push(err.message); }

    // 성별
    try {
      const data = await callNaverAPI(NAVER_API.shoppingCategoryGender, {
        startDate, endDate, timeUnit,
        category: cat.code,
      });
      apiCalls++;
      saveShoppingCategoryResults(db, insertCat, jobId, data, timeUnit, "", "by_gender", "", startDate, endDate);
      console.log(`[쇼핑] ${cat.name} 성별 ✓`);
    } catch (err: any) { errors.push(err.message); }

    // 연령별
    try {
      const data = await callNaverAPI(NAVER_API.shoppingCategoryAge, {
        startDate, endDate, timeUnit,
        category: cat.code,
      });
      apiCalls++;
      saveShoppingCategoryResults(db, insertCat, jobId, data, timeUnit, "", "", "by_age", startDate, endDate);
      console.log(`[쇼핑] ${cat.name} 연령별 ✓`);
    } catch (err: any) { errors.push(err.message); }
  }

  // 5~8. 키워드별 트렌드 (있으면)
  if (keywords?.length) {
    // 같은 카테고리끼리 묶어서 5개씩
    const byCategory = groupBy(keywords, k => k.categoryCode);

    for (const [catCode, kws] of Object.entries(byCategory)) {
      const kwChunks = chunkArray(kws, 5);
      for (const chunk of kwChunks) {
        // 기본 트렌드
        try {
          const data = await callNaverAPI(NAVER_API.shoppingKeyword, {
            startDate, endDate, timeUnit,
            category: catCode,
            keyword: chunk.map(k => ({ name: k.keyword, param: [k.keyword] })),
          });
          apiCalls++;
          saveShoppingKeywordResults(db, insertKw, jobId, catCode, data, timeUnit, "", "", "", startDate, endDate);
          console.log(`[쇼핑KW] ${chunk.map(k=>k.keyword).join(',')} ✓`);
        } catch (err: any) { errors.push(err.message); }

        // 키워드 기기별
        for (const kw of chunk) {
          try {
            const data = await callNaverAPI(NAVER_API.shoppingKeywordDevice, {
              startDate, endDate, timeUnit,
              category: catCode,
              keyword: kw.keyword,
            });
            apiCalls++;
            saveShoppingKeywordResults(db, insertKw, jobId, catCode, data, timeUnit, "by_device", "", "", startDate, endDate);
          } catch (err: any) { errors.push(err.message); }

          // 키워드 성별
          try {
            const data = await callNaverAPI(NAVER_API.shoppingKeywordGender, {
              startDate, endDate, timeUnit,
              category: catCode,
              keyword: kw.keyword,
            });
            apiCalls++;
            saveShoppingKeywordResults(db, insertKw, jobId, catCode, data, timeUnit, "", "by_gender", "", startDate, endDate);
          } catch (err: any) { errors.push(err.message); }

          // 키워드 연령별
          try {
            const data = await callNaverAPI(NAVER_API.shoppingKeywordAge, {
              startDate, endDate, timeUnit,
              category: catCode,
              keyword: kw.keyword,
            });
            apiCalls++;
            saveShoppingKeywordResults(db, insertKw, jobId, catCode, data, timeUnit, "", "", "by_age", startDate, endDate);
          } catch (err: any) { errors.push(err.message); }
        }
      }
    }
  }

  db.prepare(
    "UPDATE collect_jobs SET finished_at = datetime('now'), status = ?, api_calls = ?, error = ? WHERE id = ?"
  ).run(errors.length ? "partial" : "done", apiCalls, errors.length ? errors.join("\n") : null, jobId);

  db.close();
  console.log(`\n✅ 쇼핑인사이트 수집 완료 — API 호출: ${apiCalls}회, 오류: ${errors.length}건`);
  return { jobId, apiCalls, errors: errors.length };
}

function saveShoppingCategoryResults(
  db: any, stmt: any, jobId: any, data: any,
  timeUnit: string, device: string, gender: string, ages: string,
  startDate: string, endDate: string
) {
  if (!data?.results) return;
  for (const result of data.results) {
    for (const point of result.data || []) {
      stmt.run(jobId, result.title, result.category?.[0] || "", timeUnit, device, gender, ages, startDate, endDate, point.period, point.ratio);
    }
  }
}

function saveShoppingKeywordResults(
  db: any, stmt: any, jobId: any, catCode: string, data: any,
  timeUnit: string, device: string, gender: string, ages: string,
  startDate: string, endDate: string
) {
  if (!data?.results) return;
  for (const result of data.results) {
    for (const point of result.data || []) {
      stmt.run(jobId, catCode, result.title, timeUnit, device, gender, ages, startDate, endDate, point.period, point.ratio);
    }
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const key = fn(item);
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
