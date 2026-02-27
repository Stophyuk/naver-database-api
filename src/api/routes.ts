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

// ── Viewtory 확장 엔드포인트 ──

// 실시간 검색어 (최신)
router.get("/realtime", (req, res) => {
  const db = getDb();
  const source = req.query.source as string;
  const limit = parseInt(req.query.limit as string) || 50;

  let sql = `SELECT * FROM realtime_rankings WHERE collected_at = (SELECT MAX(collected_at) FROM realtime_rankings`;
  const params: any[] = [];

  if (source) {
    sql += ` WHERE source = ?`;
    params.push(source);
  }
  sql += `)`;
  if (source) {
    sql += ` AND source = ?`;
    params.push(source);
  }
  sql += ` ORDER BY rank ASC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

// 실시간 키워드 이력
router.get("/realtime/history", (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword as string;
  const limit = parseInt(req.query.limit as string) || 100;

  if (!keyword) {
    db.close();
    return res.status(400).json({ error: "keyword 필수" });
  }

  const rows = db.prepare(
    `SELECT * FROM realtime_rankings WHERE keyword = ? ORDER BY collected_at DESC LIMIT ?`
  ).all(keyword, limit);
  db.close();
  res.json(rows);
});

// 키워드 통계
router.get("/keyword-stats", (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword as string;

  if (!keyword) {
    db.close();
    return res.status(400).json({ error: "keyword 필수" });
  }

  const rows = db.prepare(
    `SELECT * FROM keyword_stats WHERE keyword = ? ORDER BY collected_at DESC LIMIT 10`
  ).all(keyword);
  db.close();
  res.json(rows);
});

// 연관 키워드
router.get("/related-keywords", (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword as string;

  if (!keyword) {
    db.close();
    return res.status(400).json({ error: "keyword 필수" });
  }

  const rows = db.prepare(
    `SELECT * FROM related_keywords WHERE seed_keyword = ? ORDER BY collected_at DESC LIMIT 50`
  ).all(keyword);
  db.close();
  res.json(rows);
});

// 자동완성
router.get("/suggestions", (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword as string;

  if (!keyword) {
    db.close();
    return res.status(400).json({ error: "keyword 필수" });
  }

  const rows = db.prepare(
    `SELECT * FROM naver_suggestions WHERE seed_keyword = ? ORDER BY collected_at DESC, rank ASC LIMIT 50`
  ).all(keyword);
  db.close();
  res.json(rows);
});

// 네이버 검색결과수
router.get("/search-volume", (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword as string;
  const type = req.query.type as string;

  if (!keyword) {
    db.close();
    return res.status(400).json({ error: "keyword 필수" });
  }

  let sql = `SELECT * FROM naver_search_volume WHERE keyword = ?`;
  const params: any[] = [keyword];
  if (type) {
    sql += ` AND search_type = ?`;
    params.push(type);
  }
  sql += ` ORDER BY collected_at DESC LIMIT 50`;

  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

// 구글 검색결과수
router.get("/google-stats", (req, res) => {
  const db = getDb();
  const keyword = req.query.keyword as string;

  if (!keyword) {
    db.close();
    return res.status(400).json({ error: "keyword 필수" });
  }

  const rows = db.prepare(
    `SELECT * FROM google_search_stats WHERE keyword = ? ORDER BY collected_at DESC LIMIT 50`
  ).all(keyword);
  db.close();
  res.json(rows);
});

// 수집 로그
router.get("/collection-logs", (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string) || 50;
  const rows = db.prepare(
    `SELECT * FROM collection_logs ORDER BY id DESC LIMIT ?`
  ).all(limit);
  db.close();
  res.json(rows);
});

// ── 분석 엔드포인트 ──

// 블루오션 키워드 순위
router.get("/blue-ocean", (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const rows = db.prepare(`
      SELECT keyword, score, data FROM analysis_results
      WHERE analysis_type = 'blue_ocean'
        AND analyzed_at = (SELECT MAX(analyzed_at) FROM analysis_results WHERE analysis_type = 'blue_ocean')
      ORDER BY score DESC
      LIMIT ?
    `).all(limit);
    db.close();
    res.json(rows.map((r: any) => ({ ...JSON.parse(r.data), score: r.score })));
  } catch {
    db.close();
    res.json([]);
  }
});

// 급상승/급하락 키워드
router.get("/trending", (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days as string) || 7;

  try {
    const rows = db.prepare(`
      SELECT keyword, score, data FROM analysis_results
      WHERE analysis_type = 'trending'
        AND analyzed_at = (SELECT MAX(analyzed_at) FROM analysis_results WHERE analysis_type = 'trending')
      ORDER BY ABS(score - 1) DESC
    `).all();
    db.close();
    res.json(rows.map((r: any) => ({ ...JSON.parse(r.data), score: r.score })));
  } catch {
    db.close();
    res.json([]);
  }
});

// 종합 기회 점수
router.get("/opportunity", (req, res) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string) || 50;

  try {
    const rows = db.prepare(`
      SELECT keyword, score, data FROM analysis_results
      WHERE analysis_type = 'opportunity'
        AND analyzed_at = (SELECT MAX(analyzed_at) FROM analysis_results WHERE analysis_type = 'opportunity')
      ORDER BY score DESC
      LIMIT ?
    `).all(limit);
    db.close();
    res.json(rows.map((r: any) => ({ ...JSON.parse(r.data), score: r.score })));
  } catch {
    db.close();
    res.json([]);
  }
});

// DB 통계
router.get("/stats", (req, res) => {
  const db = getDb();
  const tables = [
    "tracked_keywords", "tracked_categories", "search_trends",
    "shopping_category_trends", "shopping_keyword_trends",
    "realtime_rankings", "keyword_stats", "related_keywords",
    "naver_suggestions", "naver_search_volume", "google_search_stats",
    "collection_logs", "analysis_results",
  ];

  const stats: Record<string, number> = {};
  for (const t of tables) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${t}`).get() as any;
      stats[t] = row.cnt;
    } catch {
      stats[t] = -1;
    }
  }

  // DB 파일 크기
  const fs = require("fs");
  const { config } = require("../config");
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = fs.statSync(config.dbPath).size;
  } catch {}

  const expandedGroups = db.prepare(
    "SELECT COUNT(*) as cnt FROM tracked_keywords WHERE source = 'expanded' AND active = 1"
  ).get() as any;
  const originalGroups = db.prepare(
    "SELECT COUNT(*) as cnt FROM tracked_keywords WHERE (source IS NULL OR source != 'expanded') AND active = 1"
  ).get() as any;

  db.close();
  res.json({
    tables: stats,
    dbSizeMB: Math.round(dbSizeBytes / 1024 / 1024 * 100) / 100,
    keywordGroups: {
      original: originalGroups?.cnt || 0,
      expanded: expandedGroups?.cnt || 0,
    },
  });
});

export default router;
