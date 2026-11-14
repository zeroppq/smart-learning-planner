import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { retrieveParagraphs } from "./retriever";

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "smart-learning-retriever-"));
  process.env.DATABASE_FILE = join(workDir, "test.db");
  closeDatabase();

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_material
      (source_material_id, material_name, material_format, material_text, parse_status,
       paragraph_count, is_preset, created_at, updated_at)
     VALUES ('mat-1', '讲义.md', 'md', '二进制与编码', 'success', 3, 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO knowledge_point
      (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
       paragraph_text, knowledge_point_order, created_at, updated_at)
     VALUES ('kp-1', 'mat-1', '数制与编码', '第一章', 1, '计算机内部使用二进制表示数据。', 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO knowledge_point
      (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
       paragraph_text, knowledge_point_order, created_at, updated_at)
     VALUES ('kp-2', 'mat-1', '计算机网络', '第四章', 8, 'IP 地址用于唯一标识网络中的主机。', 2, ?, ?)`,
  ).run(now, now);
});

afterEach(() => {
  closeDatabase();
  delete process.env.DATABASE_FILE;
  rmSync(workDir, { recursive: true, force: true });
});

describe("关键词检索", () => {
  it("按问题命中最相关的知识点并带出处", () => {
    const results = retrieveParagraphs("为什么用二进制", { limit: 2 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].knowledgePointId).toBe("kp-1");
    expect(results[0].materialName).toBe("讲义.md");
    expect(results[0].paragraphIndex).toBe(1);
  });

  it("问题与资料无关时返回空列表", () => {
    const results = retrieveParagraphs("量子纠缠与超光速", { limit: 2 });
    expect(results).toEqual([]);
  });

  it("空问题不检索", () => {
    expect(retrieveParagraphs("   ")).toEqual([]);
  });
});