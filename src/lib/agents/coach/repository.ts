import { getDatabase, nowIso } from "@/lib/db";
import type { CoachPointContext } from "./system-prompt";

export type MasteryStatus = "not_started" | "learning" | "passed" | "needs_review";
export type LayerResult = "not_attempted" | "pass" | "fail" | "partial";
export type MasteryLayer = "explain" | "practice" | "apply";

const LAYER_COLUMN: Record<MasteryLayer, string> = {
  explain: "explain_result",
  practice: "practice_result",
  apply: "apply_result",
};

const REVIEW_INTERVALS = [1, 3, 7];

export interface MasteryRecord {
  mastery_record_id: string;
  knowledge_point_id: string;
  mastery_status: MasteryStatus;
  explain_result: LayerResult;
  practice_result: LayerResult;
  apply_result: LayerResult;
  rejudge_used: number;
  weak_point_flag: number;
  review_count: number;
  review_due_at: string | null;
  last_studied_at: string | null;
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getMastery(knowledgePointId: string): MasteryRecord | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM mastery_record WHERE knowledge_point_id = ?")
    .get(knowledgePointId) as unknown as MasteryRecord | undefined;
}

export function getOrCreateMastery(knowledgePointId: string): MasteryRecord {
  const existing = getMastery(knowledgePointId);
  if (existing) {
    return existing;
  }

  const db = getDatabase();
  const now = nowIso();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT OR IGNORE INTO mastery_record
      (mastery_record_id, knowledge_point_id, mastery_status, explain_result, practice_result,
       apply_result, rejudge_used, weak_point_flag, review_count, created_at, updated_at)
     VALUES (?, ?, 'not_started', 'not_attempted', 'not_attempted', 'not_attempted', 0, 0, 0, ?, ?)`,
  ).run(id, knowledgePointId, now, now);

  return getMastery(knowledgePointId) as MasteryRecord;
}

export function recordLayerResult(input: {
  knowledgePointId: string;
  layer: MasteryLayer;
  result: Exclude<LayerResult, "not_attempted">;
}): MasteryRecord {
  const record = getOrCreateMastery(input.knowledgePointId);
  const db = getDatabase();
  const now = nowIso();

  const next = {
    explain_result: record.explain_result,
    practice_result: record.practice_result,
    apply_result: record.apply_result,
  };
  next[LAYER_COLUMN[input.layer] as "explain_result"] = input.result;

  const results = [next.explain_result, next.practice_result, next.apply_result];
  let masteryStatus: MasteryStatus;

  if (results.every((item) => item === "pass")) {
    masteryStatus = "passed";
  } else if (results.some((item) => item === "fail" || item === "partial")) {
    masteryStatus = "needs_review";
  } else {
    masteryStatus = "learning";
  }

  const weakPoint = results.some((item) => item === "fail" || item === "partial") ? 1 : 0;
  const nextReviewCount = masteryStatus === "passed" ? Number(record.review_count) + 1 : Number(record.review_count);
  const interval = REVIEW_INTERVALS[Math.min(Math.max(nextReviewCount - 1, 0), REVIEW_INTERVALS.length - 1)];
  const reviewDueAt = masteryStatus === "passed" ? addDays(todayString(), interval) : record.review_due_at;

  db.prepare(
    `UPDATE mastery_record SET
       explain_result = ?, practice_result = ?, apply_result = ?,
       mastery_status = ?, weak_point_flag = ?, review_count = ?, review_due_at = ?,
       last_studied_at = ?, updated_at = ?
     WHERE knowledge_point_id = ?`,
  ).run(
    next.explain_result,
    next.practice_result,
    next.apply_result,
    masteryStatus,
    weakPoint,
    nextReviewCount,
    reviewDueAt,
    now,
    now,
    input.knowledgePointId,
  );

  return getMastery(input.knowledgePointId) as MasteryRecord;
}

export function consumeRejudge(knowledgePointId: string): boolean {
  const db = getDatabase();
  const now = nowIso();
  const result = db
    .prepare(
      `UPDATE mastery_record SET rejudge_used = 1, updated_at = ?
        WHERE knowledge_point_id = ? AND rejudge_used = 0`,
    )
    .run(now, knowledgePointId);

  return Number(result.changes) > 0;
}

export function getPointContext(knowledgePointId: string): CoachPointContext | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT k.knowledge_point_id, k.point_title, k.chapter_name, k.paragraph_text,
              k.paragraph_index, m.material_name
         FROM knowledge_point k
         JOIN source_material m ON m.source_material_id = k.source_material_id
        WHERE k.knowledge_point_id = ?`,
    )
    .get(knowledgePointId) as
    | {
        knowledge_point_id: string;
        point_title: string;
        chapter_name: string;
        paragraph_text: string;
        paragraph_index: number;
        material_name: string;
      }
    | undefined;

  if (!row) {
    return undefined;
  }

  return {
    knowledgePointId: row.knowledge_point_id,
    pointTitle: row.point_title,
    chapterName: row.chapter_name,
    paragraphText: row.paragraph_text,
    paragraphIndex: row.paragraph_index,
    materialName: row.material_name,
  };
}

export interface ReviewCandidate {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
  reviewDueAt: string | null;
  masteryStatus: string;
}

export function listDueReviews(limit = 2): ReviewCandidate[] {
  const db = getDatabase();
  const today = todayString();
  const rows = db
    .prepare(
      `SELECT k.knowledge_point_id, k.point_title, k.chapter_name,
              mr.review_due_at, mr.mastery_status
         FROM mastery_record mr
         JOIN knowledge_point k ON k.knowledge_point_id = mr.knowledge_point_id
        WHERE mr.mastery_status = 'passed' AND mr.review_due_at IS NOT NULL AND mr.review_due_at <= ?
        ORDER BY mr.review_due_at ASC
        LIMIT ?`,
    )
    .all(today, limit) as Array<{
    knowledge_point_id: string;
    point_title: string;
    chapter_name: string;
    review_due_at: string | null;
    mastery_status: string;
  }>;

  return rows.map((row) => ({
    knowledgePointId: row.knowledge_point_id,
    pointTitle: row.point_title,
    chapterName: row.chapter_name,
    reviewDueAt: row.review_due_at,
    masteryStatus: row.mastery_status,
  }));
}

export function listRecentlyStudied(limit = 2): ReviewCandidate[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT k.knowledge_point_id, k.point_title, k.chapter_name,
              mr.review_due_at, mr.mastery_status
         FROM mastery_record mr
         JOIN knowledge_point k ON k.knowledge_point_id = mr.knowledge_point_id
        WHERE mr.mastery_status IN ('passed', 'needs_review', 'learning')
        ORDER BY mr.last_studied_at DESC
        LIMIT ?`,
    )
    .all(limit) as Array<{
    knowledge_point_id: string;
    point_title: string;
    chapter_name: string;
    review_due_at: string | null;
    mastery_status: string;
  }>;

  return rows.map((row) => ({
    knowledgePointId: row.knowledge_point_id,
    pointTitle: row.point_title,
    chapterName: row.chapter_name,
    reviewDueAt: row.review_due_at,
    masteryStatus: row.mastery_status,
  }));
}

export function recordStudySession(input: {
  knowledgePointId: string;
  stage: string;
}): void {
  const db = getDatabase();
  const now = nowIso();
  db.prepare(
    `INSERT INTO study_session
      (study_session_id, knowledge_point_id, session_stage, study_started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), input.knowledgePointId, input.stage, now, now, now);
}
/**
 * 附录里的练习题参考答案不切成知识点，但在督学出题与评判时可以引用。
 * 按知识点编号（如 1.1）在附录中定位对应答案块。
 */
export function getReferenceNotes(point: CoachPointContext): string {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT m.material_text
         FROM knowledge_point k
         JOIN source_material m ON m.source_material_id = k.source_material_id
        WHERE k.knowledge_point_id = ?`,
    )
    .get(point.knowledgePointId) as { material_text: string } | undefined;

  const text = row?.material_text ?? "";
  const appendixIndex = text.indexOf("## 附录");
  if (appendixIndex === -1) {
    return "";
  }

  const code = /^(\d+\.\d+)/.exec(point.pointTitle)?.[1];
  if (!code) {
    return "";
  }

  const blocks = text
    .slice(appendixIndex)
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const startIndex = blocks.findIndex((block) => block.startsWith(`**${code}`));
  if (startIndex === -1) {
    return "";
  }

  const collected: string[] = [];
  for (let index = startIndex; index < blocks.length && collected.length < 3; index += 1) {
    if (index > startIndex && /^\*\*\d+\.\d+/.test(blocks[index])) {
      break;
    }
    collected.push(blocks[index]);
  }

  return collected.join("\n\n").slice(0, 1000);
}