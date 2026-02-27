import Database from "better-sqlite3";
import { config } from "../config";
import fs from "fs";
import path from "path";

export function getDb(): Database.Database {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initDb() {
  const db = getDb();

  // 수집 작업 로그
  db.exec(`
    CREATE TABLE IF NOT EXISTS collect_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      api_calls INTEGER DEFAULT 0,
      error TEXT
    )
  `);

  // 검색어 트렌드 데이터
  db.exec(`
    CREATE TABLE IF NOT EXISTS search_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES collect_jobs(id),
      collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      keyword_group TEXT NOT NULL,
      keywords TEXT NOT NULL,
      time_unit TEXT NOT NULL,
      device TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      ages TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      period TEXT NOT NULL,
      ratio REAL NOT NULL
    )
  `);

  // 쇼핑인사이트 분야별 트렌드
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopping_category_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES collect_jobs(id),
      collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      category TEXT NOT NULL,
      category_code TEXT NOT NULL,
      time_unit TEXT NOT NULL,
      device TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      ages TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      period TEXT NOT NULL,
      ratio REAL NOT NULL
    )
  `);

  // 쇼핑인사이트 키워드별 트렌드
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopping_keyword_trends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES collect_jobs(id),
      collected_at TEXT NOT NULL DEFAULT (datetime('now')),
      category_code TEXT NOT NULL,
      keyword TEXT NOT NULL,
      time_unit TEXT NOT NULL,
      device TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      ages TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      period TEXT NOT NULL,
      ratio REAL NOT NULL
    )
  `);

  // 수집 대상 키워드 관리
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_group TEXT NOT NULL,
      keywords TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 쇼핑 카테고리 관리
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_name TEXT NOT NULL,
      category_code TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // 인덱스
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_search_period ON search_trends(keyword_group, period);
    CREATE INDEX IF NOT EXISTS idx_search_collected ON search_trends(collected_at);
    CREATE INDEX IF NOT EXISTS idx_shopping_cat_period ON shopping_category_trends(category_code, period);
    CREATE INDEX IF NOT EXISTS idx_shopping_kw_period ON shopping_keyword_trends(keyword, period);
  `);

  // ── Viewtory 확장 테이블 ──

  db.exec(`
    CREATE TABLE IF NOT EXISTS realtime_rankings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      keyword TEXT NOT NULL,
      rank INTEGER NOT NULL,
      category TEXT,
      metadata TEXT,
      collected_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_realtime_source_date ON realtime_rankings(source, collected_at);
    CREATE INDEX IF NOT EXISTS idx_realtime_keyword ON realtime_rankings(keyword, collected_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS keyword_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      monthly_pc_cnt INTEGER,
      monthly_mobile_cnt INTEGER,
      monthly_pc_clk REAL,
      monthly_mobile_clk REAL,
      monthly_pc_ctr REAL,
      monthly_mobile_ctr REAL,
      pl_avg_depth REAL,
      comp_idx TEXT,
      collected_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_kwstats_keyword ON keyword_stats(keyword, collected_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS related_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_keyword TEXT NOT NULL,
      related_keyword TEXT NOT NULL,
      monthly_pc_cnt INTEGER,
      monthly_mobile_cnt INTEGER,
      comp_idx TEXT,
      collected_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_relkw_seed ON related_keywords(seed_keyword, collected_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS naver_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed_keyword TEXT NOT NULL,
      suggestion TEXT NOT NULL,
      rank INTEGER,
      collected_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_suggest_seed ON naver_suggestions(seed_keyword, collected_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS google_search_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      total_results BIGINT,
      collected_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_google_keyword ON google_search_stats(keyword, collected_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS naver_search_volume (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      search_type TEXT NOT NULL,
      total_results INTEGER,
      collected_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_naver_vol_keyword ON naver_search_volume(keyword, search_type, collected_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      api_calls INTEGER DEFAULT 0,
      rows_inserted INTEGER DEFAULT 0,
      error_message TEXT,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);

  console.log("✅ DB 초기화 완료:", config.dbPath);
  db.close();
}

// 직접 실행 시
if (require.main === module) {
  initDb();
}
