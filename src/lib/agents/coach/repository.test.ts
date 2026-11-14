import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  consumeRejudge,
  getMastery,
  recordLayerResult,
} from "./repository";

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "smart-learning-coach-"));
  process.env.DATABASE_FILE = join(workDir, "test.db");
  closeDatabase();
  seedPoint();
});

afterEach(() => {
  closeDatabase();
  delete process.env.DATABASE_FILE;
  rmSync(workDir, { recursive: true, force: true });
});

function seedPoint(): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_material
      (source_material_id, material_name, material_format, material_text, parse_status,
       paragraph_count, is_preset, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'success', 2, 1, ?, ?)`,
  ).run("mat-1", "测试讲义.md", "md", "计算机使用二进制表示数据。", now, now);

  db.prepare(
    `INSERT INTO knowledge_point
      (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
       paragraph_text, knowledge_point_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("kp-1", "mat-1", "数制与编码", "第一章", 1, "计算机使用二进制表示数据。", 1, now, now);
}

function seedPlan(): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO learning_goal
      (learning_goal_id, goal_text, daily_minutes, goal_status, created_at, updated_at)
     VALUES ('goal-1', '学懂计算机基础', 40, 'active', ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO plan
      (plan_id, learning_goal_id, plan_version, plan_status, route_json, created_at, updated_at)
     VALUES ('plan-1', 'goal-1', 1, 'active', '[]', ?, ?)`,
  ).run(now, now);
}

describe("掌握状态机", () => {
  it("第一层通过后进入学习中", () => {
    const record = recordLayerResult({ knowledgePointId: "kp-1", layer: "explain", result: "pass" });

    expect(record.mastery_status).toBe("learning");
    expect(record.explain_result).toBe("pass");
  });

  it("任一层未通过标记为待回炉", () => {
    recordLayerResult({ knowledgePointId: "kp-1", layer: "explain", result: "pass" });
    const record = recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: "fail" });

    expect(record.mastery_status).toBe("needs_review");
    expect(record.weak_point_flag).toBe(1);
  });

  it("三层全部通过后标记为已通过并安排下次复习", () => {
    recordLayerResult({ knowledgePointId: "kp-1", layer: "explain", result: "pass" });
    recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: "pass" });
    const record = recordLayerResult({ knowledgePointId: "kp-1", layer: "apply", result: "pass" });

    expect(record.mastery_status).toBe("passed");
    expect(record.review_count).toBe(1);
    expect(record.review_due_at).toBeTruthy();
    expect(record.weak_point_flag).toBe(0);
  });
});

describe("重判", () => {
  it("只允许使用一次重判机会", () => {
    recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: "fail" });

    expect(consumeRejudge("kp-1")).toBe(true);
    expect(consumeRejudge("kp-1")).toBe(false);
    expect(getMastery("kp-1")?.rejudge_used).toBe(1);
  });
});

describe("督学与规划师的边界", () => {
  it("判定结果不会修改计划表", () => {
    seedPlan();
    const before = getDatabase()
      .prepare("SELECT plan_id, plan_version, plan_status, route_json FROM plan WHERE plan_id = 'plan-1'")
      .get();

    recordLayerResult({ knowledgePointId: "kp-1", layer: "explain", result: "pass" });
    recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: "pass" });
    recordLayerResult({ knowledgePointId: "kp-1", layer: "apply", result: "pass" });

    const after = getDatabase()
      .prepare("SELECT plan_id, plan_version, plan_status, route_json FROM plan WHERE plan_id = 'plan-1'")
      .get();

    expect(after).toEqual(before);
  });
});