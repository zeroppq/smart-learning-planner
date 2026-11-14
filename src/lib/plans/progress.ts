import { randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db";
import { addDays, todayString } from "@/lib/agents/planner/schema";
import { getActiveGoal, getCurrentPlanView } from "./repository";

export interface ProgressRouteNode {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
  pointStatus: string;
  nodeOrder: number;
  prerequisitePointId: string | null;
}

export interface ProgressSummary {
  planId: string;
  planVersion: number;
  goalText: string;
  dailyMinutes: number;
  total: number;
  passed: number;
  learning: number;
  needsReview: number;
  notStarted: number;
  streakDays: number;
  dueReviewCount: number;
  lastStudied: { knowledgePointId: string; pointTitle: string; lastStudiedAt: string } | null;
  route: ProgressRouteNode[];
}

export function resetProgressState(): void {
  const db = getDatabase();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM study_session").run();
    db.prepare("DELETE FROM mastery_record").run();
    db.prepare("DELETE FROM adjustment_proposal").run();
    db.prepare("DELETE FROM daily_task").run();
    db.prepare("DELETE FROM plan").run();
    db.prepare("DELETE FROM learning_goal").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getProgressSummary(): ProgressSummary | null {
  const plan = getCurrentPlanView();
  if (!plan) {
    return null;
  }

  const db = getDatabase();
  const route: ProgressRouteNode[] = plan.route.map((node) => ({
    knowledgePointId: node.knowledge_point_id,
    pointTitle: node.point_title,
    chapterName: node.chapter_name,
    pointStatus: node.point_status,
    nodeOrder: node.node_order,
    prerequisitePointId: node.prerequisite_point_id,
  }));

  const passed = route.filter((node) => node.pointStatus === "passed").length;
  const learning = route.filter((node) => node.pointStatus === "learning").length;
  const needsReview = route.filter((node) => node.pointStatus === "needs_review").length;
  const notStarted = route.filter((node) => node.pointStatus === "not_started").length;

  const today = todayString();
  const dueRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM mastery_record
        WHERE mastery_status = 'passed' AND review_due_at IS NOT NULL AND review_due_at <= ?`,
    )
    .get(today) as { count: number };

  const lastRow = db
    .prepare(
      `SELECT mr.knowledge_point_id, k.point_title, mr.last_studied_at
         FROM mastery_record mr
         JOIN knowledge_point k ON k.knowledge_point_id = mr.knowledge_point_id
        WHERE mr.last_studied_at IS NOT NULL
        ORDER BY mr.last_studied_at DESC
        LIMIT 1`,
    )
    .get() as
    | { knowledge_point_id: string; point_title: string; last_studied_at: string }
    | undefined;

  const sessionRows = db
    .prepare(
      "SELECT DISTINCT substr(study_started_at, 1, 10) AS study_date FROM study_session ORDER BY study_date DESC",
    )
    .all() as Array<{ study_date: string }>;
  const studiedDates = new Set(sessionRows.map((row) => row.study_date));

  let streakDays = 0;
  let cursor = today;
  if (!studiedDates.has(cursor)) {
    cursor = addDays(cursor, -1);
  }
  while (studiedDates.has(cursor)) {
    streakDays += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    planId: plan.plan_id,
    planVersion: plan.plan_version,
    goalText: plan.goal.goal_text,
    dailyMinutes: plan.goal.daily_minutes,
    total: route.length,
    passed,
    learning,
    needsReview,
    notStarted,
    streakDays,
    dueReviewCount: Number(dueRow.count),
    lastStudied: lastRow
      ? {
          knowledgePointId: lastRow.knowledge_point_id,
          pointTitle: lastRow.point_title,
          lastStudiedAt: lastRow.last_studied_at,
        }
      : null,
    route,
  };
}

/**
 * 小调整自动执行：
 * 1. 过期未完成任务顺延到今天，不需要用户确认。
 * 2. 待回炉知识点若今天没有任务，自动补一条回炉任务。
 */
export function reconcilePlan(): { movedTasks: number; addedReviewTasks: number } {
  const db = getDatabase();
  const goal = getActiveGoal();
  if (!goal) {
    return { movedTasks: 0, addedReviewTasks: 0 };
  }

  const planRow = db
    .prepare(
      "SELECT plan_id FROM plan WHERE learning_goal_id = ? AND plan_status = 'active' ORDER BY plan_version DESC LIMIT 1",
    )
    .get(goal.learning_goal_id) as { plan_id: string } | undefined;

  if (!planRow) {
    return { movedTasks: 0, addedReviewTasks: 0 };
  }

  const today = todayString();
  const now = nowIso();

  const moved = db
    .prepare(
      `UPDATE daily_task SET task_date = ?, updated_at = ?
        WHERE plan_id = ? AND task_status = 'pending' AND task_date < ?`,
    )
    .run(today, now, planRow.plan_id, today);

  const needsReviewRows = db
    .prepare(
      `SELECT mr.knowledge_point_id, k.point_title
         FROM mastery_record mr
         JOIN knowledge_point k ON k.knowledge_point_id = mr.knowledge_point_id
        WHERE mr.mastery_status = 'needs_review'`,
    )
    .all() as Array<{ knowledge_point_id: string; point_title: string }>;

  const insertTask = db.prepare(
    `INSERT INTO daily_task
      (daily_task_id, plan_id, knowledge_point_id, task_date, estimated_minutes, task_status,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
  );

  let addedReviewTasks = 0;
  for (const row of needsReviewRows) {
    const exists = db
      .prepare(
        "SELECT 1 FROM daily_task WHERE plan_id = ? AND knowledge_point_id = ? AND task_date = ? LIMIT 1",
      )
      .get(planRow.plan_id, row.knowledge_point_id, today);

    if (!exists) {
      insertTask.run(
        randomUUID(),
        planRow.plan_id,
        row.knowledge_point_id,
        today,
        Math.max(10, Math.round(goal.daily_minutes / 2)),
        now,
        now,
      );
      addedReviewTasks += 1;
    }
  }

  return { movedTasks: Number(moved.changes), addedReviewTasks };
}