import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import { createAdjustmentProposal, decideProposal, getPendingProposal } from "./adjustment";

let workDir = "";

function seed(options: { withPendingTask: boolean; withNeedsReview: boolean }): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_material
      (source_material_id, material_name, material_format, material_text, parse_status,
       paragraph_count, is_preset, created_at, updated_at)
     VALUES ('mat-1', '讲义.md', 'md', '内容', 'success', 2, 1, ?, ?)`,
  ).run(now, now);

  for (let index = 1; index <= 2; index += 1) {
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
  ];
  db.prepare(
    `INSERT INTO plan
      (plan_id, learning_goal_id, plan_version, plan_status, route_json, created_at, updated_at)
     VALUES ('plan-1', 'goal-1', 1, 'active', ?, ?, ?)`,
  ).run(JSON.stringify(route), now, now);

  if (options.withPendingTask) {
    db.prepare(
      `INSERT INTO daily_task
        (daily_task_id, plan_id, knowledge_point_id, task_date, estimated_minutes, task_status,
         created_at, updated_at)
       VALUES ('task-1', 'plan-1', 'kp-1', '2026-11-20', 20, 'pending', ?, ?)`,
    ).run(now, now);
  }

  if (options.withNeedsReview) {
    db.prepare(
      `INSERT INTO mastery_record
        (mastery_record_id, knowledge_point_id, mastery_status, explain_result, practice_result,
         apply_result, rejudge_used, weak_point_flag, review_count, created_at, updated_at)
       VALUES ('mr-1', 'kp-2', 'needs_review', 'pass', 'fail', 'not_attempted', 0, 1, 0, ?, ?)`,
    ).run(now, now);
  }
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "smart-learning-adjust-"));
  process.env.DATABASE_FILE = join(workDir, "test.db");
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.DATABASE_FILE;
  rmSync(workDir, { recursive: true, force: true });
});

describe("大调提案", () => {
  it("进度正常时不生成调整方案", () => {
    seed({ withPendingTask: false, withNeedsReview: false });
    const result = createAdjustmentProposal();

    expect(result.ok).toBe(false);
  });

  it("有未通过知识点时生成调整方案，并给出前后对比", () => {
    seed({ withPendingTask: true, withNeedsReview: true });
    const result = createAdjustmentProposal();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.change.before.needsReview).toBe(1);
      expect(result.proposal.change.after.newPlanVersion).toBe(2);
    }
  });

  it("重复请求时复用同一份待处理方案", () => {
    seed({ withPendingTask: true, withNeedsReview: true });
    const first = createAdjustmentProposal();
    const second = createAdjustmentProposal();

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.proposal.adjustment_proposal_id).toBe(first.proposal.adjustment_proposal_id);
    }
  });
});

describe("确认与拒绝", () => {
  it("确认后计划版本递增，任务重新排期", () => {
    seed({ withPendingTask: true, withNeedsReview: true });
    const created = createAdjustmentProposal();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const result = decideProposal(created.proposal.adjustment_proposal_id, "accept");
    expect(result.ok).toBe(true);
    expect(result.planVersion).toBe(2);

    const plan = getDatabase()
      .prepare("SELECT plan_version FROM plan WHERE plan_id = 'plan-1'")
      .get() as { plan_version: number };
    expect(plan.plan_version).toBe(2);
  });

  it("拒绝后计划版本不变，方案标记为已拒绝", () => {
    seed({ withPendingTask: true, withNeedsReview: true });
    const created = createAdjustmentProposal();
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const result = decideProposal(created.proposal.adjustment_proposal_id, "reject");
    expect(result.ok).toBe(true);

    const plan = getDatabase()
      .prepare("SELECT plan_version FROM plan WHERE plan_id = 'plan-1'")
      .get() as { plan_version: number };
    expect(plan.plan_version).toBe(1);
    expect(getPendingProposal()).toBeUndefined();
  });
});