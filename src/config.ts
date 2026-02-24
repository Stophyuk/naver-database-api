import dotenv from "dotenv";
dotenv.config();

export const config = {
  naver: {
    clientId: process.env.NAVER_CLIENT_ID || "",
    clientSecret: process.env.NAVER_CLIENT_SECRET || "",
  },
  port: parseInt(process.env.PORT || "3100"),
  collectCron: process.env.COLLECT_CRON || "0 */12 * * *",
  dbPath: process.env.DB_PATH || "./data/naver-datalab.db",
};

// 네이버 데이터랩 API 상수
export const NAVER_API = {
  searchTrend: "https://openapi.naver.com/v1/datalab/search",
  shoppingCategory: "https://openapi.naver.com/v1/datalab/shopping/categories",
  shoppingCategoryDevice: "https://openapi.naver.com/v1/datalab/shopping/category/device",
  shoppingCategoryGender: "https://openapi.naver.com/v1/datalab/shopping/category/gender",
  shoppingCategoryAge: "https://openapi.naver.com/v1/datalab/shopping/category/age",
  shoppingKeyword: "https://openapi.naver.com/v1/datalab/shopping/category/keywords",
  shoppingKeywordDevice: "https://openapi.naver.com/v1/datalab/shopping/category/keyword/device",
  shoppingKeywordGender: "https://openapi.naver.com/v1/datalab/shopping/category/keyword/gender",
  shoppingKeywordAge: "https://openapi.naver.com/v1/datalab/shopping/category/keyword/age",
} as const;

// 필터 옵션 전체 경우의 수
export const FILTERS = {
  devices: ["", "pc", "mo"] as const,         // 전체, PC, 모바일
  genders: ["", "m", "f"] as const,            // 전체, 남, 여
  ages: ["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"] as const,
  // 1: 0~12세, 2: 13~18세, 3: 19~24세, 4: 25~29세, 5: 30~34세,
  // 6: 35~39세, 7: 40~44세, 8: 45~49세, 9: 50~54세, 10: 55~59세, 11: 60세+
  timeUnits: ["date", "week", "month"] as const,
} as const;

// API 호출 제한
export const RATE_LIMIT = {
  dailyMax: 1000,
  delayMs: 100, // 호출 간 딜레이
};
