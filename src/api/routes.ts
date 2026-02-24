import { Router } from "express";
import { getDb } from "../db/init";
import { getDailyCallCount } from "../utils/naver-client";

const router = Router();

// 상태 확인
router.get("/status", (req, res) => {
  const db = getDb();
  const lastJob = db.prepare(
    "SELECT * FROM collect_jobs ORDER BY id DESC LIMIT 1"
  ).get();
  const keywordCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM tracked_keywords WHERE active = 1"
  ).get() as any;
  const categoryCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM tracked_categories WHERE active = 1"
  ).get() as any;
  const searchRows = db.prepare("SELECT COUNT(*) as cnt FROM search_trends").get() as any;
  const shoppingRows = db.prepare("SELECT COUNT(*) as cnt FROM shopping_category_trends").get() as any;
  db.close();

  res.json({
    status: "ok",
    dailyApiCalls: getDailyCallCount(),
    trackedKeywords: keywordCount?.cnt || 0,
    trackedCategories: categoryCount?.cnt || 0,
    totalSearchTrends: searchRows?.cnt || 0,
    totalShoppingTrends: shoppingRows?.cnt || 0,
    lastJob,
  });
});

// 수집 이력
router.get("/jobs", (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string) || 20;
  const jobs = db.prepare("SELECT * FROM collect_jobs ORDER BY id DESC LIMIT ?").all(limit);
  db.close();
  res.json(jobs);
});

// 키워드 관리
router.get("/keywords", (req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM tracked_keywords WHERE active = 1").all();
  db.close();
  res.json(rows);
});

router.post("/keywords", (req, res) => {
  const { groupName, keywords, category } = req.body;
  if (!groupName || !keywords?.length) {
    return res.status(400).json({ error: "groupName과 keywords 필수" });
  }
  const db = getDb();
  db.prepare(
    "INSERT INTO tracked_keywords (keyword_group, keywords, category) VALUES (?, ?, ?)"
  ).run(groupName, JSON.stringify(keywords), category || "general");
  db.close();
  res.json({ ok: true });
});

router.delete("/keywords/:id", (req, res) => {
  const db = getDb();
  db.prepare("UPDATE tracked_keywords SET active = 0 WHERE id = ?").run(req.params.id);
  db.close();
  res.json({ ok: true });
});

// 카테고리 관리
router.get("/categories", (req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM tracked_categories WHERE active = 1").all();
  db.close();
  res.json(rows);
});

router.post("/categories", (req, res) => {
  const { name, code } = req.body;
  if (!name || !code) {
    return res.status(400).json({ error: "name과 code 필수" });
  }
  const db = getDb();
  db.prepare(
    "INSERT INTO tracked_categories (category_name, category_code) VALUES (?, ?)"
  ).run(name, code);
  db.close();
  res.json({ ok: true });
});

// 검색어 트렌드 조회
router.get("/trends/search", (req, res) => {
  const db = getDb();
  const { keyword, timeUnit, device, gender, age, limit: lim } = req.query;
  const limit = parseInt(lim as string) || 100;

  let sql = "SELECT * FROM search_trends WHERE 1=1";
  const params: any[] = [];

  if (keyword) { sql += " AND keyword_group = ?"; params.push(keyword); }
  if (timeUnit) { sql += " AND time_unit = ?"; params.push(timeUnit); }
  if (device) { sql += " AND device = ?"; params.push(device); }
  if (gender) { sql += " AND gender = ?"; params.push(gender); }
  if (age) { sql += " AND ages = ?"; params.push(age); }

  sql += " ORDER BY period DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

// 쇼핑 트렌드 조회
router.get("/trends/shopping", (req, res) => {
  const db = getDb();
  const { category, categoryCode, limit: lim } = req.query;
  const limit = parseInt(lim as string) || 100;

  let sql = "SELECT * FROM shopping_category_trends WHERE 1=1";
  const params: any[] = [];

  if (category) { sql += " AND category = ?"; params.push(category); }
  if (categoryCode) { sql += " AND category_code = ?"; params.push(categoryCode); }

  sql += " ORDER BY period DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

export default router;
