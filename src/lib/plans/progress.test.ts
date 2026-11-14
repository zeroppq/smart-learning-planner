import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { addDays, todayString } from "@/lib/agents/planner/schema";
import { getProgressSummary, reconcilePlan } from "./progress";

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "smart-learning-progress-"));
  process.env.DATABASE_FILE = join(workDir, "test.db");
  closeDatabase();

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_material
      (source_material_id, material_name, material_format, material_text, parse_status,
       paragraph_count, is_preset, created_at, updated_at)
     VALUES ('mat-1', '讲义.md', 'md', '内容', 'success', 3, 1, ?, ?)`,
  ).run(now, now);

  for (let index = 1; index <= 3; index += 1) {
    db.prepare(
      `INSERT INTO knowledge_point
        (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
         paragraph_text, knowledge_point_order, created_at, updated_at)
       VALUES (?, 'mat-1', ?, '第一章', ?, '内容', ?, ?, ?)`,
    ).run(`kp-${index}`, `知识点 ${index}`, index, index, now, now);
  }

  db.prepare(
    `INSERT INTO learning_goal
      (learning_goal_id, goal_text, daily_minutes, goal_status, created_at, updated_at)
     VALUES ('goal-1', '学懂计算机基础', 40, 'active', ?, ?)`,
  ).run(now, now);

  const route = [
    { knowledge_point_id: "kp-1", prerequisite_point_id: null, node_order: 1, stage: "foundation" },
    { knowledge_point_id: "kp-2", prerequisite_point_id: "kp-1", node_order: 2, stage: "core" },
    { knowledge_point_id: "kp-3", prerequisite_point_id: "kp-2", node_order: 3, stage: "application" },
  ];

  db.prepare(
    `INSERT INTO plan
      (plan_id, learning_goal_id, plan_version, plan_status, route_json, created_at, updated_at)
     VALUES ('plan-1', 'goal-1', 1, 'active', ?, ?, ?)`,
  ).run(JSON.stringify(route), now, now);

  db.prepare(
    `INSERT INTO daily_task
      (daily_task_id, plan_id, knowledge_point_id, task_date, estimated_minutes, task_status,
       created_at, updated_at)
     VALUES ('task-1', 'plan-1', 'kp-1', ?, 20, 'pending', ?, ?)`,
  ).run(addDays(todayString(), -2), now, now);

  db.prepare(
    `INSERT INTO mastery_record
      (mastery_record_id, knowledge_point_id, mastery_status, explain_result, practice_result,
       apply_result, rejudge_used, weak_point_flag, review_count, last_studied_at, created_at, updated_at)
     VALUES ('mr-1', 'kp-2', 'needs_review', 'pass', 'fail', 'not_attempted', 0, 1, 0, ?, ?, ?)`,
  ).run(now, now, now);
});

afterEach(() => {
  closeDatabase();
  delete process.env.DATABASE_FILE;
  rmSync(workDir, { recursive: true, force: true });
});

describe("小调整自动执行", () => {
  it("过期任务自动顺延到今天", () => {
    const result = reconcilePlan();
    expect(result.movedTasks).toBe(1);

    const task = getDatabase()
      .prepare("SELECT task_date FROM daily_task WHERE daily_task_id = 'task-1'")
      .get() as { task_date: string };
    expect(task.task_date).toBe(todayString());
  });

  it("待回炉知识点自动补一条今日任务，且不重复补", () => {
    const first = reconcilePlan();
    expect(first.addedReviewTasks).toBe(1);

    const second = reconcilePlan();
    expect(second.addedReviewTasks).toBe(0);
  });
});

describe("进度汇总", () => {
  it("统计已通过、待回炉与上次停留位置", () => {
    const summary = getProgressSummary();
    expect(summary).not.toBeNull();
    expect(summary?.total).toBe(3);
    expect(summary?.needsReview).toBe(1);
    expect(summary?.passed).toBe(0);
    expect(summary?.lastStudied?.knowledgePointId).toBe("kp-2");
  });

  it("同一天重复打开，状态保持一致", () => {
    reconcilePlan();
    const first = getProgressSummary();
    reconcilePlan();
    const second = getProgressSummary();

    expect(second?.needsReview).toBe(first?.needsReview);
    expect(second?.total).toBe(first?.total);
  });
});