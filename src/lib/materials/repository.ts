import { randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db";
import { type KnowledgePointDraft, chunkKnowledgePoints } from "./chunk";
import { detectFormat, parseMaterial, splitParagraphs } from "./parse";
import {
  PRESET_COURSE_ID,
  PRESET_COURSE_NAME,
  loadPresetCourseText,
} from "./preset-course";

export class MaterialFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialFormatError";
  }
}

export interface MaterialSummary {
  source_material_id: string;
  material_name: string;
  material_format: string;
  parse_status: string;
  paragraph_count: number;
  is_preset: number;
  knowledge_point_count: number;
  created_at: string;
}

export interface KnowledgePointSummary {
  knowledge_point_id: string;
  point_title: string;
  chapter_name: string;
  paragraph_index: number;
  knowledge_point_order: number;
}

export interface KnowledgePointDetail extends KnowledgePointSummary {
  paragraph_text: string;
  source_material_id: string;
  material_name: string;
}

export interface CreateMaterialResult {
  materialId: string;
  parseStatus: "success" | "failed";
  knowledgePointCount: number;
  errorMessage?: string;
}

export function listMaterials(): MaterialSummary[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT m.source_material_id, m.material_name, m.material_format, m.parse_status,
              m.paragraph_count, m.is_preset, m.created_at,
              (SELECT COUNT(*) FROM knowledge_point k
                WHERE k.source_material_id = m.source_material_id) AS knowledge_point_count
         FROM source_material m
        ORDER BY m.is_preset DESC, m.created_at ASC`,
    )
    .all() as unknown as MaterialSummary[];
}

export function listKnowledgePoints(materialId: string): KnowledgePointSummary[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT knowledge_point_id, point_title, chapter_name, paragraph_index, knowledge_point_order
         FROM knowledge_point
        WHERE source_material_id = ?
        ORDER BY knowledge_point_order ASC`,
    )
    .all(materialId) as unknown as KnowledgePointSummary[];
}

export function getKnowledgePointDetail(
  knowledgePointId: string,
): KnowledgePointDetail | undefined {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT k.knowledge_point_id, k.source_material_id, k.point_title, k.chapter_name,
              k.paragraph_index, k.paragraph_text, k.knowledge_point_order, m.material_name
         FROM knowledge_point k
         JOIN source_material m ON m.source_material_id = k.source_material_id
        WHERE k.knowledge_point_id = ?`,
    )
    .get(knowledgePointId) as unknown as KnowledgePointDetail | undefined;
}

export function getMaterial(materialId: string): MaterialSummary | undefined {
  return listMaterials().find((item) => item.source_material_id === materialId);
}

export async function createMaterial(input: {
  fileName: string;
  buffer: Buffer;
}): Promise<CreateMaterialResult> {
  const format = detectFormat(input.fileName);
  if (!format) {
    throw new MaterialFormatError("当前仅支持 TXT / MD / PDF 三种格式。");
  }

  const db = getDatabase();
  const materialId = randomUUID();
  const now = nowIso();

  db.prepare(
    `INSERT INTO source_material
      (source_material_id, material_name, material_format, material_text, parse_status,
       paragraph_count, is_preset, created_at, updated_at)
     VALUES (?, ?, ?, '', 'processing', 0, 0, ?, ?)`,
  ).run(materialId, input.fileName, format, now, now);

  try {
    const parsed = await parseMaterial(input.fileName, input.buffer);
    const drafts = chunkKnowledgePoints(parsed.paragraphs);

    db.exec("BEGIN");
    try {
      db.prepare(
        `UPDATE source_material
            SET material_text = ?, parse_status = 'success', paragraph_count = ?, updated_at = ?
          WHERE source_material_id = ?`,
      ).run(parsed.text, parsed.paragraphs.length, nowIso(), materialId);

      insertKnowledgePoints(materialId, drafts);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      materialId,
      parseStatus: "success",
      knowledgePointCount: drafts.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析失败，请换一份资料重试。";
    db.prepare(
      `UPDATE source_material SET parse_status = 'failed', updated_at = ? WHERE source_material_id = ?`,
    ).run(nowIso(), materialId);

    return {
      materialId,
      parseStatus: "failed",
      knowledgePointCount: 0,
      errorMessage: message,
    };
  }
}

function insertKnowledgePoints(
  materialId: string,
  drafts: KnowledgePointDraft[],
): void {
  const db = getDatabase();
  const insert = db.prepare(
    `INSERT INTO knowledge_point
      (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
       paragraph_text, knowledge_point_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = nowIso();
  for (const draft of drafts) {
    insert.run(
      randomUUID(),
      materialId,
      draft.pointTitle,
      draft.chapterName,
      draft.paragraphIndex,
      draft.paragraphText,
      draft.knowledgePointOrder,
      now,
      now,
    );
  }
}

export function ensurePresetCourse(): { materialId: string; seeded: boolean } {
  const db = getDatabase();
  const existing = db
    .prepare("SELECT parse_status FROM source_material WHERE source_material_id = ?")
    .get(PRESET_COURSE_ID) as { parse_status: string } | undefined;

  if (existing?.parse_status === "success") {
    return { materialId: PRESET_COURSE_ID, seeded: false };
  }

  const presetText = loadPresetCourseText();
  const paragraphs = splitParagraphs(presetText);
  const drafts = chunkKnowledgePoints(paragraphs);
  const now = nowIso();

  db.exec("BEGIN");
  try {
    db.prepare(
      `DELETE FROM study_session
        WHERE knowledge_point_id IN
          (SELECT knowledge_point_id FROM knowledge_point WHERE source_material_id = ?)`,
    ).run(PRESET_COURSE_ID);
    db.prepare(
      `DELETE FROM mastery_record
        WHERE knowledge_point_id IN
          (SELECT knowledge_point_id FROM knowledge_point WHERE source_material_id = ?)`,
    ).run(PRESET_COURSE_ID);
    db.prepare(
      `DELETE FROM daily_task
        WHERE knowledge_point_id IN
          (SELECT knowledge_point_id FROM knowledge_point WHERE source_material_id = ?)`,
    ).run(PRESET_COURSE_ID);
    db.prepare("DELETE FROM knowledge_point WHERE source_material_id = ?").run(PRESET_COURSE_ID);

    db.prepare(
      `INSERT INTO source_material
        (source_material_id, material_name, material_format, material_text, parse_status,
         paragraph_count, is_preset, created_at, updated_at)
       VALUES (?, ?, 'md', ?, 'success', ?, 1, ?, ?)
       ON CONFLICT(source_material_id) DO UPDATE SET
         material_name = excluded.material_name,
         material_text = excluded.material_text,
         parse_status = excluded.parse_status,
         paragraph_count = excluded.paragraph_count,
         is_preset = excluded.is_preset,
         updated_at = excluded.updated_at`,
    ).run(
      PRESET_COURSE_ID,
      PRESET_COURSE_NAME,
      presetText,
      paragraphs.length,
      now,
      now,
    );

    insertKnowledgePoints(PRESET_COURSE_ID, drafts);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { materialId: PRESET_COURSE_ID, seeded: true };
}