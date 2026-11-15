import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";

vi.mock("@/lib/agents/planner/service", () => ({
  generatePlanDraft: vi.fn(async () => ({
    route: [
      { knowledge_point_id: "kp-1", prerequisite_point_id: null, node_order: 1, stage: "core" as const },
    ],
    daily_tasks: [
      { task_date: "2026-11-15", knowledge_point_id: "kp-1", estimated_minutes: 20 },
    ],
  })),
}));

import { POST } from "./route";

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "smart-learning-plans-route-"));
  process.env.DATABASE_FILE = join(workDir, "test.db");
  closeDatabase();

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_material
      (source_material_id, material_name, material_format, material_text, parse_status,
       paragraph_count, is_preset, created_at, updated_at)
     VALUES ('mat-1', '测试讲义.md', 'md', '计算机使用二进制表示数据。', 'success', 1, 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO knowledge_point
      (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
       paragraph_text, knowledge_point_order, created_at, updated_at)
     VALUES ('kp-1', 'mat-1', '数制与编码', '第一章', 1, '计算机使用二进制表示数据。', 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO learning_goal
      (learning_goal_id, goal_text, daily_minutes, goal_status, created_at, updated_at)
     VALUES ('goal-active', '学懂计算机基础', 40, 'active', ?, ?)`,
  ).run(now, now);
});

afterEach(() => {
  closeDatabase();
  delete process.env.DATABASE_FILE;
  rmSync(workDir, { recursive: true, force: true });
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("计划生成接口对过期 goalId 的兜底（热修 C-4 回归锁定）", () => {
  it("传入过期 goalId 时不再 409，按当前生效目标继续生成", async () => {
    const response = await POST(makeRequest({ goalId: "已归档的旧目标", answers: [] }));
    const data = (await response.json()) as {
      ok: boolean;
      plan?: { goal: { learning_goal_id: string }; plan_version: number; daily_tasks: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.plan?.goal.learning_goal_id).toBe("goal-active");
    expect(data.plan?.plan_version).toBe(1);
    expect(data.plan?.daily_tasks).toHaveLength(1);
  });

  it("不传 goalId 时同样按当前生效目标生成", async () => {
    const response = await POST(makeRequest({ answers: [] }));
    const data = (await response.json()) as {
      ok: boolean;
      plan?: { goal: { learning_goal_id: string } };
    };

    expect(response.status).toBe(200);
    expect(data.plan?.goal.learning_goal_id).toBe("goal-active");
  });
});