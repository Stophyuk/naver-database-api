import express from "express";
import { Cron } from "croner";
import { config } from "./config";
import { initDb } from "./db/init";
import apiRoutes from "./api/routes";

const app = express();
app.use(express.json());

// API 라우트
app.use("/api", apiRoutes);

// 헬스체크
app.get("/", (req, res) => {
  res.json({
    name: "naver-database-api",
    version: "0.1.0",
    description: "네이버 데이터랩 수집/분석 서버",
    endpoints: {
      status: "GET /api/status",
      jobs: "GET /api/jobs",
      keywords: "GET|POST /api/keywords",
      categories: "GET|POST /api/categories",
      searchTrends: "GET /api/trends/search",
      shoppingTrends: "GET /api/trends/shopping",
    },
  });
});

// DB 초기화
initDb();

// 12시간 크론잡
const collectJob = new Cron(config.collectCron, async () => {
  console.log("⏰ 크론 수집 시작:", new Date().toISOString());
  try {
    // 동적 import로 수집 실행
    const { default: child_process } = await import("child_process");
    child_process.execSync("npx tsx src/collect.ts", {
      stdio: "inherit",
      env: process.env,
    });
  } catch (err) {
    console.error("❌ 크론 수집 실패:", err);
  }
});

console.log(`⏰ 크론 설정: ${config.collectCron} (다음 실행: ${collectJob.nextRun()?.toISOString()})`);

app.listen(config.port, () => {
  console.log(`🚀 서버 시작: http://localhost:${config.port}`);
});
