import { randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db";
import { addDays, todayString } from "@/lib/agents/planner/schema";
import { getActiveGoal } from "./repository";

export interface AdjustmentChange {
  summary: string;
  before: { pendingTasks: number; overdueTasks: number; needsReview: number; planVersion: number };
  after: { extendedDays: number; tasksPerDay: number; newPlanVersion: number };
}

export interface AdjustmentProposalView {
  adjustment_proposal_id: string;
  plan_id: string;
  proposal_reason: string;
  proposal_status: string;
  created_at: string;
  change: AdjustmentChange;
}

interface ProposalRow {
  adjustment_proposal_id: string;
  plan_id: string;
  proposal_reason: string;
  proposal_content: string;
  proposal_status: string;
  created_at: string;
}

function toView(row: ProposalRow): AdjustmentProposalView {
  let change: AdjustmentChange = {
    summary: "",
    before: { pendingTasks: 0, overdueTasks: 0, needsReview: 0, planVersion: 1 },
    after: { extendedDays: 0, tasksPerDay: 0, newPlanVersion: 1 },
  };
  try {
    change = JSON.parse(row.proposal_content) as AdjustmentChange;
  } catch {
    // 内容损坏时返回空变更，页面仍可展示原因
  }

  return {
    adjustment_proposal_id: row.adjustment_proposal_id,
    plan_id: row.plan_id,
    proposal_reason: row.proposal_reason,
    proposal_status: row.proposal_status,
    created_at: row.created_at,
    change,
  };
}

export function getPendingProposal(): AdjustmentProposalView | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      "SELECT * FROM adjustment_proposal WHERE proposal_status = 'pending' ORDER BY created_at DESC LIMIT 1",
    )
    .get() as ProposalRow | undefined;
  return row ? toView(row) : undefined;
}

export function createAdjustmentProposal():
  | { ok: true; proposal: AdjustmentProposalView }
  | { ok: false; reason: string } {
  const goal = getActiveGoal();
  if (!goal) {
    return { ok: false, reason: "还没有学习目标，无法生成调整方案。" };
  }

  const db = getDatabase();
  const planRow = db
    .prepare(
      "SELECT plan_id, plan_version FROM plan WHERE learning_goal_id = ? AND plan_status = 'active' ORDER BY plan_version DESC LIMIT 1",
    )
    .get(goal.learning_goal_id) as { plan_id: string; plan_version: number } | undefined;

  if (!planRow) {
    return { ok: false, reason: "还没有学习计划，无法生成调整方案。" };
  }

  const existing = getPendingProposal();
  if (existing) {
    return { ok: true, proposal: existing };
  }

  const today = todayString();
  const pendingRow = db
    .prepare(
      "SELECT COUNT(*) AS count FROM daily_task WHERE plan_id = ? AND task_status = 'pending'",
    )
    .get(planRow.plan_id) as { count: number };
  const overdueRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM daily_task
        WHERE plan_id = ? AND task_status = 'pending' AND task_date < ?`,
    )
    .get(planRow.plan_id, today) as { count: number };
  const reviewRow = db
    .prepare("SELECT COUNT(*) AS count FROM mastery_record WHERE mastery_status = 'needs_review'")
    .get() as { count: number };

  const pendingTasks = Number(pendingRow.count);
  const overdueTasks = Number(overdueRow.count);
  const needsReview = Number(reviewRow.count);

  if (pendingTasks === 0 && needsReview === 0) {
    return { ok: false, reason: "当前没有待完成任务，也没有待回炉知识点，计划不需要调整。" };
  }

  const totalToSchedule = Math.max(pendingTasks, needsReview, 1);
  const extendedDays = Math.min(14, Math.max(3, Math.ceil(totalToSchedule / 2)));
  const tasksPerDay = Math.min(3, Math.max(1, Math.ceil(totalToSchedule / extendedDays)));

  const change: AdjustmentChange = {
    summary: `把 ${pendingTasks} 个待完成知识点重新排到未来 ${extendedDays} 天，每天约 ${tasksPerDay} 项，并优先安排 ${needsReview} 个待回炉知识点。`,
    before: {
      pendingTasks,
      overdueTasks,
      needsReview,
      planVersion: Number(planRow.plan_version),
    },
    after: {
      extendedDays,
      tasksPerDay,
      newPlanVersion: Number(planRow.plan_version) + 1,
    },
  };

  const reason =
    needsReview > 0
      ? `有 ${needsReview} 个知识点未通过判定，继续按原节奏推进容易越学越虚。`
      : `有 ${overdueTasks} 项任务已经过期，原计划节奏已经跟不上。`;

  const proposalId = randomUUID();
  const now = nowIso();

  db.prepare(
    `INSERT INTO adjustment_proposal
      (adjustment_proposal_id, plan_id, proposal_reason, proposal_content, proposal_status,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(proposalId, planRow.plan_id, reason, JSON.stringify(change), now, now);

  return {
    ok: true,
    proposal: toView({
      adjustment_proposal_id: proposalId,
      plan_id: planRow.plan_id,
      proposal_reason: reason,
      proposal_content: JSON.stringify(change),
      proposal_status: "pending",
      created_at: now,
    }),
  };
}

export function decideProposal(
  proposalId: string,
  action: "accept" | "reject",
): { ok: boolean; planVersion?: number; error?: string } {
  const db = getDatabase();
  const row = db
    .prepare("SELECT * FROM adjustment_proposal WHERE adjustment_proposal_id = ?")
    .get(proposalId) as ProposalRow | undefined;

  if (!row) {
    return { ok: false, error: "调整方案不存在。" };
  }
  if (row.proposal_status !== "pending") {
    return { ok: false, error: "这个调整方案已经处理过了。" };
  }

  const now = nowIso();

  if (action === "reject") {
    db.prepare(
      "UPDATE adjustment_proposal SET proposal_status = 'rejected', updated_at = ? WHERE adjustment_proposal_id = ?",
    ).run(now, proposalId);
    return { ok: true };
  }

  let change: AdjustmentChange;
  try {
    change = JSON.parse(row.proposal_content) as AdjustmentChange;
  } catch {
    return { ok: false, error: "调整方案内容损坏，无法应用。" };
  }

  const planRow = db
    .prepare("SELECT plan_id, learning_goal_id, plan_version FROM plan WHERE plan_id = ?")
    .get(row.plan_id) as { plan_id: string; learning_goal_id: string; plan_version: number } | undefined;

  if (!planRow) {
    return { ok: false, error: "对应的计划不存在。" };
  }

  const goal = db
    .prepare("SELECT daily_minutes FROM learning_goal WHERE learning_goal_id = ?")
    .get(planRow.learning_goal_id) as { daily_minutes: number } | undefined;
  const dailyMinutes = Number(goal?.daily_minutes ?? 40);

  const tasks = db
    .prepare(
      `SELECT daily_task_id FROM daily_task
        WHERE plan_id = ? AND task_status = 'pending'
        ORDER BY task_date ASC, created_at ASC`,
    )
    .all(planRow.plan_id) as Array<{ daily_task_id: string }>;

  const nextVersion = Number(planRow.plan_version) + 1;
  const startDate = addDays(todayString(), 1);

  db.exec("BEGIN");
  try {
    const updateTask = db.prepare(
      "UPDATE daily_task SET task_date = ?, estimated_minutes = ?, updated_at = ? WHERE daily_task_id = ?",
    );

    tasks.forEach((task, index) => {
      const dayOffset = Math.floor(index / Math.max(1, change.after.tasksPerDay));
      updateTask.run(
        addDays(startDate, Math.min(dayOffset, change.after.extendedDays - 1)),
        Math.max(5, Math.round(dailyMinutes / Math.max(1, change.after.tasksPerDay))),
        now,
        task.daily_task_id,
      );
    });

    db.prepare("UPDATE plan SET plan_version = ?, updated_at = ? WHERE plan_id = ?").run(
      nextVersion,
      now,
      planRow.plan_id,
    );
    db.prepare(
      "UPDATE adjustment_proposal SET proposal_status = 'accepted', updated_at = ? WHERE adjustment_proposal_id = ?",
    ).run(now, proposalId);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    return { ok: false, error: "应用调整方案时出错，原计划保持不变。" };
  }

  return { ok: true, planVersion: nextVersion };
}