import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TABLE_NAMES, closeDatabase, createDatabase, getDatabase } from "./db";

const createdDirs: string[] = [];

function makeDatabaseFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "smart-learning-db-"));
  createdDirs.push(dir);
  return join(dir, "test.db");
}

describe("数据库结构", () => {
  it("建立 8 张表，表名与设计文档一致", () => {
    const db = createDatabase(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    const names = rows.map((row) => row.name).sort();

    expect(names).toEqual([...TABLE_NAMES].sort());
    db.close();
  });

  it("关键表字段名与 design.md 的 D9 一致", () => {
    const db = createDatabase(":memory:");

    function columnsOf(table: string): string[] {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      return rows.map((row) => row.name);
    }

    expect(columnsOf("mastery_record")).toEqual(
      expect.arrayContaining([
        "mastery_record_id",
        "knowledge_point_id",
        "mastery_status",
        "explain_result",
        "practice_result",
        "apply_result",
        "rejudge_used",
        "weak_point_flag",
        "review_due_at",
      ]),
    );
    expect(columnsOf("knowledge_point")).toEqual(
      expect.arrayContaining([
        "knowledge_point_id",
        "source_material_id",
        "point_title",
        "chapter_name",
        "paragraph_index",
        "paragraph_text",
        "knowledge_point_order",
      ]),
    );
    expect(columnsOf("adjustment_proposal")).toEqual(
      expect.arrayContaining([
        "adjustment_proposal_id",
        "plan_id",
        "proposal_reason",
        "proposal_content",
        "proposal_status",
      ]),
    );

    db.close();
  });
});

describe("数据持久化", () => {
  let databaseFile = "";

  beforeEach(() => {
    databaseFile = makeDatabaseFile();
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {
      // 忽略关闭异常，测试目录随后统一清理
    }
    while (createdDirs.length > 0) {
      const dir = createdDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("写入后关闭再打开，记录仍然存在", () => {
    const first = createDatabase(databaseFile);
    const timestamp = new Date().toISOString();
    first
      .prepare(
        `INSERT INTO learning_goal
          (learning_goal_id, goal_text, daily_minutes, goal_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("goal-persist-test", "持久化验证目标", 40, "active", timestamp, timestamp);
    first.close();

    const second = createDatabase(databaseFile);
    const row = second
      .prepare("SELECT goal_text, daily_minutes FROM learning_goal WHERE learning_goal_id = ?")
      .get("goal-persist-test") as { goal_text: string; daily_minutes: number } | undefined;
    second.close();

    expect(row).toEqual({ goal_text: "持久化验证目标", daily_minutes: 40 });
  });

  it("通过 DATABASE_FILE 环境变量定位数据库文件", () => {
    process.env.DATABASE_FILE = databaseFile;
    const db = getDatabase();
    const row = db.prepare("PRAGMA database_list").all() as Array<{ file: string }>;
    delete process.env.DATABASE_FILE;

    expect(row.some((item) => item.file.includes("test.db"))).toBe(true);
  });
});