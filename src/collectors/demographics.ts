import { getDb } from "../db/init";
import { callNaverAPI } from "../utils/naver-client";

const DATALAB_SEARCH_URL = "https://openapi.naver.com/v1/datalab/search";

interface DemographicRow {
  keyword: string;
  gender_male: number | null;
  gender_female: number | null;
  age_group: string | null;
  age_percentage: number | null;
  best_day: string | null;
  day_ratios: string | null;
  collected_at: string;
}

function getDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export async function collectDemographics(): Promise<{ apiCalls: number; rowsInserted: number }> {
  const db = getDb();

  // 원본 키워드만 (source != 'expanded')
  const trackedRows = db.prepare(
    "SELECT keyword_group, keywords FROM tracked_keywords WHERE active = 1 AND (source IS NULL OR source != 'expanded')"
  ).all() as { keyword_group: string; keywords: string }[];

  const allKeywords: string[] = [];
  for (const row of trackedRows) {
    allKeywords.push(...(JSON.parse(row.keywords) as string[]));
  }

  // 중복 제거
  const uniqueKeywords = [...new Set(allKeywords)];
  if (uniqueKeywords.length === 0) {
    db.close();
    return { apiCalls: 0, rowsInserted: 0 };
  }

  const now = new Date().toISOString();
  const { startDate, endDate } = getDateRange();
  let apiCalls = 0;
  let rowsInserted = 0;

  const stmt = db.prepare(`
    INSERT INTO keyword_demographics (keyword, gender_male, gender_female, age_group, age_percentage, best_day, day_ratios, collected_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 5개씩 그룹으로 묶어서 API 호출 (한 번에 최대 5개 키워드 그룹)
  const chunks = chunkArray(uniqueKeywords, 5);

  for (const chunk of chunks) {
    const keywordGroups = chunk.map((kw, i) => ({
      groupName: kw,
      keywords: [kw],
    }));

    // 1. 성별 비교: 남성
    try {
      const maleData = await callNaverAPI(DATALAB_SEARCH_URL, {
        startDate,
        endDate,
        timeUnit: "month",
        keywordGroups: keywordGroups.map(g => ({ groupName: g.groupName, keywords: g.keywords })),
        gender: "m",
      });
      apiCalls++;

      const femaleData = await callNaverAPI(DATALAB_SEARCH_URL, {
        startDate,
        endDate,
        timeUnit: "month",
        keywordGroups: keywordGroups.map(g => ({ groupName: g.groupName, keywords: g.keywords })),
        gender: "f",
      });
      apiCalls++;

      // 각 키워드의 남녀 비율 계산
      for (const kw of chunk) {
        const maleResult = maleData?.results?.find((r: any) => r.title === kw);
        const femaleResult = femaleData?.results?.find((r: any) => r.title === kw);

        const maleAvg = maleResult?.data?.length
          ? maleResult.data.reduce((s: number, d: any) => s + d.ratio, 0) / maleResult.data.length
          : 0;
        const femaleAvg = femaleResult?.data?.length
          ? femaleResult.data.reduce((s: number, d: any) => s + d.ratio, 0) / femaleResult.data.length
          : 0;

        const total = maleAvg + femaleAvg;
        const maleRatio = total > 0 ? Math.round((maleAvg / total) * 10000) / 100 : null;
        const femaleRatio = total > 0 ? Math.round((femaleAvg / total) * 10000) / 100 : null;

        stmt.run(kw, maleRatio, femaleRatio, null, null, null, null, now);
        rowsInserted++;
      }
    } catch (err) {
      console.error(`⚠️ Demographics 성별 수집 실패:`, (err as Error).message);
    }

    // 2. 연령별 (ages: 1~11)
    const ageGroups = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
    const ageLabels: Record<string, string> = {
      "1": "0-12", "2": "13-18", "3": "19-24", "4": "25-29", "5": "30-34",
      "6": "35-39", "7": "40-44", "8": "45-49", "9": "50-54", "10": "55-59", "11": "60+",
    };

    try {
      const ageResults: Map<string, { age: string; avg: number }[]> = new Map();
      for (const kw of chunk) ageResults.set(kw, []);

      for (const age of ageGroups) {
        try {
          const data = await callNaverAPI(DATALAB_SEARCH_URL, {
            startDate,
            endDate,
            timeUnit: "month",
            keywordGroups: keywordGroups.map(g => ({ groupName: g.groupName, keywords: g.keywords })),
            ages: [age],
          });
          apiCalls++;

          for (const kw of chunk) {
            const result = data?.results?.find((r: any) => r.title === kw);
            const avg = result?.data?.length
              ? result.data.reduce((s: number, d: any) => s + d.ratio, 0) / result.data.length
              : 0;
            ageResults.get(kw)!.push({ age: ageLabels[age], avg });
          }
        } catch (ageErr) {
          console.error(`⚠️ Demographics 연령(${ageLabels[age]}) 실패:`, (ageErr as Error).message);
          for (const kw of chunk) {
            ageResults.get(kw)!.push({ age: ageLabels[age], avg: 0 });
          }
        }
      }

      // 각 키워드별 연령 비율 계산 및 저장
      for (const kw of chunk) {
        const ages = ageResults.get(kw)!;
        const totalAge = ages.reduce((s, a) => s + a.avg, 0);
        if (totalAge === 0) continue;

        for (const a of ages) {
          const pct = Math.round((a.avg / totalAge) * 10000) / 100;
          if (pct > 0) {
            stmt.run(kw, null, null, a.age, pct, null, null, now);
            rowsInserted++;
          }
        }
      }
    } catch (err) {
      console.error(`⚠️ Demographics 연령 수집 실패:`, (err as Error).message);
    }

    // 3. 요일별 (date 단위로 최근 4주 데이터에서 요일별 평균)
    try {
      const recentStart = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
      const data = await callNaverAPI(DATALAB_SEARCH_URL, {
        startDate: recentStart,
        endDate,
        timeUnit: "date",
        keywordGroups: keywordGroups.map(g => ({ groupName: g.groupName, keywords: g.keywords })),
      });
      apiCalls++;

      const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

      for (const kw of chunk) {
        const result = data?.results?.find((r: any) => r.title === kw);
        if (!result?.data?.length) continue;

        const dayTotals: Record<string, number[]> = {};
        for (const d of dayNames) dayTotals[d] = [];

        for (const point of result.data) {
          const dayIdx = new Date(point.period).getDay();
          dayTotals[dayNames[dayIdx]].push(point.ratio);
        }

        const dayAvgs: Record<string, number> = {};
        let maxDay = "월";
        let maxAvg = 0;
        for (const [day, vals] of Object.entries(dayTotals)) {
          const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
          dayAvgs[day] = Math.round(avg * 100) / 100;
          if (avg > maxAvg) { maxAvg = avg; maxDay = day; }
        }

        stmt.run(kw, null, null, null, null, maxDay, JSON.stringify(dayAvgs), now);
        rowsInserted++;
      }
    } catch (err) {
      console.error(`⚠️ Demographics 요일 수집 실패:`, (err as Error).message);
    }

    // 청크 간 딜레이
    await new Promise(r => setTimeout(r, 200));
  }

  db.close();
  console.log(`👥 Demographics: ${rowsInserted}개 수집, API ${apiCalls}회`);
  return { apiCalls, rowsInserted };
}
