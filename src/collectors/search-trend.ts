import { NAVER_API, FILTERS } from "../config";
import { callNaverAPI } from "../utils/naver-client";
import { getDb } from "../db/init";

interface SearchTrendParams {
  startDate: string;
  endDate: string;
  timeUnit: string;
  keywordGroups: { groupName: string; keywords: string[] }[];
  device?: string;
  gender?: string;
  ages?: string[];
}

/**
 * 검색어 트렌드 수집 — 모든 필터 조합
 * 
 * 경우의 수:
 * - timeUnit: 3 (일/주/월)
 * - device: 3 (전체/PC/모바일)
 * - gender: 3 (전체/남/여)
 * - ages: 12 (전체 + 11개 연령대)
 * = 최대 324 조합 × 키워드 그룹 수
 * 
 * API 일일 한도 1000회이므로 키워드 3그룹이면 972회 → 한도 내
 */
export async function collectSearchTrends(
  keywordGroups: { groupName: string; keywords: string[] }[],
  options?: {
    startDate?: string;
    endDate?: string;
    timeUnits?: string[];
    fullCombination?: boolean; // false면 기본 필터만
  }
) {
  const db = getDb();
  const now = new Date();
  const endDate = options?.endDate || now.toISOString().slice(0, 10);
  const startDate = options?.startDate || new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const timeUnits = options?.timeUnits || ["date", "week", "month"];
  const fullCombo = options?.fullCombination ?? true;

  // 수집 작업 시작 기록
  const job = db.prepare(
    "INSERT INTO collect_jobs (type, status) VALUES ('search_trend', 'running')"
  ).run();
  const jobId = job.lastInsertRowid;

  const insertStmt = db.prepare(`
    INSERT INTO search_trends 
    (job_id, keyword_group, keywords, time_unit, device, gender, ages, start_date, end_date, period, ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let apiCalls = 0;
  let errors: string[] = [];

  // 키워드 그룹을 5개씩 묶어서 (API 제한)
  const chunks = chunkArray(keywordGroups, 5);

  for (const chunk of chunks) {
    for (const timeUnit of timeUnits) {
      if (fullCombo) {
        // 모든 필터 조합
        for (const device of FILTERS.devices) {
          for (const gender of FILTERS.genders) {
            for (const age of FILTERS.ages) {
              try {
                const body: SearchTrendParams = {
                  startDate,
                  endDate,
                  timeUnit,
                  keywordGroups: chunk,
                };
                if (device) body.device = device;
                if (gender) body.gender = gender;
                if (age) body.ages = [age];

                const data = await callNaverAPI(NAVER_API.searchTrend, body);
                apiCalls++;

                // 결과 저장
                if (data.results) {
                  for (const result of data.results) {
                    for (const point of result.data || []) {
                      insertStmt.run(
                        jobId,
                        result.title,
                        JSON.stringify(result.keywords),
                        timeUnit,
                        device,
                        gender,
                        age,
                        startDate,
                        endDate,
                        point.period,
                        point.ratio
                      );
                    }
                  }
                }

                console.log(`[검색트렌드] ${timeUnit}/${device||'all'}/${gender||'all'}/${age||'all'} — ${chunk.map(k=>k.groupName).join(',')} ✓`);
              } catch (err: any) {
                errors.push(err.message);
                console.error(`[검색트렌드] 오류: ${err.message}`);
              }
            }
          }
        }
      } else {
        // 기본 필터만 (전체)
        try {
          const body: SearchTrendParams = {
            startDate,
            endDate,
            timeUnit,
            keywordGroups: chunk,
          };
          const data = await callNaverAPI(NAVER_API.searchTrend, body);
          apiCalls++;

          if (data.results) {
            for (const result of data.results) {
              for (const point of result.data || []) {
                insertStmt.run(
                  jobId, result.title, JSON.stringify(result.keywords),
                  timeUnit, "", "", "", startDate, endDate, point.period, point.ratio
                );
              }
            }
          }
          console.log(`[검색트렌드] ${timeUnit}/기본 — ${chunk.map(k=>k.groupName).join(',')} ✓`);
        } catch (err: any) {
          errors.push(err.message);
          console.error(`[검색트렌드] 오류: ${err.message}`);
        }
      }
    }
  }

  // 작업 완료
  db.prepare(
    "UPDATE collect_jobs SET finished_at = datetime('now'), status = ?, api_calls = ?, error = ? WHERE id = ?"
  ).run(
    errors.length ? "partial" : "done",
    apiCalls,
    errors.length ? errors.join("\n") : null,
    jobId
  );

  db.close();
  console.log(`\n✅ 검색어 트렌드 수집 완료 — API 호출: ${apiCalls}회, 오류: ${errors.length}건`);
  return { jobId, apiCalls, errors: errors.length };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
