import { getDb, initDb } from "../db/init";

/**
 * related_keywords에서 상위 3,000개 유니크 키워드를 추출하여
 * tracked_keywords에 5개씩 묶어서 등록
 */
async function expandKeywords() {
  initDb();
  const db = getDb();

  // 1. source 컬럼 추가 (없으면)
  try {
    db.exec(`ALTER TABLE tracked_keywords ADD COLUMN source TEXT DEFAULT 'original'`);
    console.log("✅ source 컬럼 추가됨");
  } catch {
    console.log("ℹ️ source 컬럼 이미 존재");
  }

  // 2. 기존 tracked_keywords의 모든 키워드 수집
  const existingRows = db.prepare(
    "SELECT keywords FROM tracked_keywords WHERE active = 1"
  ).all() as { keywords: string }[];

  const existingKeywords = new Set<string>();
  for (const row of existingRows) {
    const kws = JSON.parse(row.keywords) as string[];
    kws.forEach(k => existingKeywords.add(k));
  }
  console.log(`📋 기존 tracked 키워드: ${existingKeywords.size}개`);

  // 3. related_keywords에서 유니크 키워드 상위 3,000개 추출
  const candidates = db.prepare(`
    SELECT related_keyword, MAX(monthly_mobile_cnt) as max_mobile, MAX(comp_idx) as comp_idx
    FROM related_keywords
    WHERE monthly_mobile_cnt > 0
    GROUP BY related_keyword
    ORDER BY max_mobile DESC
    LIMIT 5000
  `).all() as { related_keyword: string; max_mobile: number; comp_idx: string }[];

  // 4. 기존 키워드 제외
  const newKeywords = candidates.filter(c => !existingKeywords.has(c.related_keyword));
  const top3000 = newKeywords.slice(0, 3000);
  console.log(`🆕 신규 키워드 후보: ${newKeywords.length}개 → 상위 ${top3000.length}개 선택`);

  if (top3000.length === 0) {
    console.log("⚠️ 등록할 새 키워드가 없습니다.");
    db.close();
    return;
  }

  // 5. 기존 확장 키워드 삭제 (재실행 시 중복 방지)
  const deleted = db.prepare(
    "DELETE FROM tracked_keywords WHERE source = 'expanded'"
  ).run();
  if (deleted.changes > 0) {
    console.log(`🗑️ 기존 확장 키워드 ${deleted.changes}개 삭제`);
  }

  // 6. 5개씩 묶어서 INSERT
  const insertStmt = db.prepare(`
    INSERT INTO tracked_keywords (keyword_group, keywords, category, active, source)
    VALUES (?, ?, 'expanded', 1, 'expanded')
  `);

  const insertAll = db.transaction(() => {
    let groupIdx = 0;
    for (let i = 0; i < top3000.length; i += 5) {
      groupIdx++;
      const chunk = top3000.slice(i, i + 5).map(c => c.related_keyword);
      const groupName = `확장_${String(groupIdx).padStart(3, "0")}`;
      insertStmt.run(groupName, JSON.stringify(chunk));
    }
    return groupIdx;
  });

  const totalGroups = insertAll();
  console.log(`✅ ${top3000.length}개 키워드를 ${totalGroups}개 그룹으로 등록 완료`);

  // 7. 통계
  const total = db.prepare("SELECT COUNT(*) as cnt FROM tracked_keywords WHERE active = 1").get() as any;
  const expanded = db.prepare("SELECT COUNT(*) as cnt FROM tracked_keywords WHERE source = 'expanded' AND active = 1").get() as any;
  console.log(`📊 전체 활성 그룹: ${total.cnt}개 (기존: ${total.cnt - expanded.cnt}, 확장: ${expanded.cnt})`);

  db.close();
}

expandKeywords().catch(err => {
  console.error("❌ 키워드 확장 실패:", err);
  process.exit(1);
});
