import { randomUUID } from "node:crypto";
import { getDatabase, nowIso } from "@/lib/db";
import type {
  PlanDailyTask,
  PlanRouteNode,
  PlanStage,
} from "@/lib/agents/planner/schema";
import { todayString } from "@/lib/agents/planner/schema";

export interface GoalRecord {
  learning_goal_id: string;
  goal_text: string;
  daily_minutes: number;
  target_date: string | null;
  goal_status: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgePointOption {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
}

export interface PlanRouteView extends PlanRouteNode {
  point_title: string;
  chapter_name: string;
  point_status: string;
}

export interface PlanTaskView {
  daily_task_id: string;
  task_date: string;
  knowledge_point_id: string;
  point_title: string;
  estimated_minutes: number;
  task_status: string;
}

export interface PlanView {
  plan_id: string;
  plan_version: number;
  plan_status: string;
  created_at: string;
  goal: GoalRecord;
  route: PlanRouteView[];
  daily_tasks: PlanTaskView[];
  today_tasks: PlanTaskView[];
}

const MAX_PLAN_POINTS = 30;

export function getActiveGoal(): GoalRecord | undefined {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM learning_goal WHERE goal_status = 'active' ORDER BY created_at DESC LIMIT 1")
    .get() as unknown as GoalRecord | undefined;
}

export function createOrReplaceActiveGoal(input: {
  goalText: string;
  dailyMinutes: number;
}): GoalRecord {
  const db = getDatabase();
  const now = nowIso();
  const goalId = randomUUID();

  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE learning_goal SET goal_status = 'archived', updated_at = ? WHERE goal_status = 'active'",
    ).run(now);
    db.prepare(
      `INSERT INTO learning_goal
        (learning_goal_id, goal_text, daily_minutes, goal_status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    ).run(goalId, input.goalText, input.dailyMinutes, now, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getActiveGoal() as GoalRecord;
}

export function updateActiveGoalDailyMinutes(dailyMinutes: number): GoalRecord | undefined {
  const db = getDatabase();
  const now = nowIso();
  db.prepare("UPDATE learning_goal SET daily_minutes = ?, updated_at = ? WHERE goal_status = 'active'").run(
    dailyMinutes,
    now,
  );
  return getActiveGoal();
}

export function listKnowledgePointOptions(limit = MAX_PLAN_POINTS): KnowledgePointOption[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT k.knowledge_point_id, k.point_title, k.chapter_name
         FROM knowledge_point k
         JOIN source_material m ON m.source_material_id = k.source_material_id
        WHERE m.parse_status = 'success'
        ORDER BY m.is_preset DESC, m.created_at ASC, k.knowledge_point_order ASC
        LIMIT ?`,
    )
    .all(limit) as Array<{
    knowledge_point_id: string;
    point_title: string;
    chapter_name: string;
  }>;

  return rows.map((row) => ({
    knowledgePointId: row.knowledge_point_id,
    pointTitle: row.point_title,
    chapterName: row.chapter_name,
  }));
}

export function savePlan(input: {
  goal: GoalRecord;
  route: PlanRouteNode[];
  dailyTasks: PlanDailyTask[];
}): PlanView {
  const db = getDatabase();
  const now = nowIso();
  const planId = randomUUID();

  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE plan SET plan_status = 'archived', updated_at = ? WHERE learning_goal_id = ? AND plan_status = 'active'",
    ).run(now, input.goal.learning_goal_id);

    const versionRow = db
      .prepare("SELECT COALESCE(MAX(plan_version), 0) AS max_version FROM plan WHERE learning_goal_id = ?")
      .get(input.goal.learning_goal_id) as { max_version: number };
    const nextVersion = Number(versionRow.max_version) + 1;

    db.prepare(
      `INSERT INTO plan
        (plan_id, learning_goal_id, plan_version, plan_status, route_json, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    ).run(
      planId,
      input.goal.learning_goal_id,
      nextVersion,
      JSON.stringify(input.route),
      now,
      now,
    );

    db.prepare(
      "DELETE FROM daily_task WHERE plan_id IN (SELECT plan_id FROM plan WHERE learning_goal_id = ?)",
    ).run(input.goal.learning_goal_id);

    const insertTask = db.prepare(
      `INSERT INTO daily_task
        (daily_task_id, plan_id, knowledge_point_id, task_date, estimated_minutes, task_status,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    );

    for (const task of input.dailyTasks) {
      insertTask.run(
        randomUUID(),
        planId,
        task.knowledge_point_id,
        task.task_date,
        task.estimated_minutes,
        now,
        now,
      );
    }

    const updatePrerequisite = db.prepare(
      "UPDATE knowledge_point SET prerequisite_point_id = ?, updated_at = ? WHERE knowledge_point_id = ?",
    );
    for (const node of input.route) {
      updatePrerequisite.run(node.prerequisite_point_id, now, node.knowledge_point_id);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getCurrentPlanView() as PlanView;
}

export function getCurrentPlanView(): PlanView | undefined {
  const db = getDatabase();
  const goal = getActiveGoal();
  if (!goal) {
    return undefined;
  }

  const plan = db
    .prepare(
      "SELECT * FROM plan WHERE learning_goal_id = ? AND plan_status = 'active' ORDER BY plan_version DESC LIMIT 1",
    )
    .get(goal.learning_goal_id) as
    | {
        plan_id: string;
        plan_version: number;
        plan_status: string;
        route_json: string;
        created_at: string;
      }
    | undefined;

  if (!plan) {
    return undefined;
  }

  let routeNodes: PlanRouteNode[] = [];
  try {
    const parsed = JSON.parse(plan.route_json) as PlanRouteNode[];
    if (Array.isArray(parsed)) {
      routeNodes = parsed;
    }
  } catch {
    routeNodes = [];
  }

  const pointRows = db
    .prepare(
      `SELECT k.knowledge_point_id, k.point_title, k.chapter_name,
              COALESCE(mr.mastery_status, 'not_started') AS point_status
         FROM knowledge_point k
         LEFT JOIN mastery_record mr ON mr.knowledge_point_id = k.knowledge_point_id`,
    )
    .all() as Array<{
    knowledge_point_id: string;
    point_title: string;
    chapter_name: string;
    point_status: string;
  }>;

  const pointMap = new Map(pointRows.map((row) => [row.knowledge_point_id, row]));

  const route: PlanRouteView[] = routeNodes
    .map((node) => {
      const point = pointMap.get(node.knowledge_point_id);
      if (!point) {
        return null;
      }
      return {
        ...node,
        point_title: point.point_title,
        chapter_name: point.chapter_name,
        point_status: point.point_status,
      };
    })
    .filter((node): node is PlanRouteView => node !== null)
    .sort((a, b) => a.node_order - b.node_order);

  const tasks = db
    .prepare(
      `SELECT t.daily_task_id, t.task_date, t.knowledge_point_id, t.estimated_minutes, t.task_status,
              k.point_title
         FROM daily_task t
         JOIN knowledge_point k ON k.knowledge_point_id = t.knowledge_point_id
        WHERE t.plan_id = ?
        ORDER BY t.task_date ASC, t.created_at ASC`,
    )
    .all(plan.plan_id) as unknown as PlanTaskView[];

  const today = todayString();

  return {
    plan_id: plan.plan_id,
    plan_version: plan.plan_version,
    plan_status: plan.plan_status,
    created_at: plan.created_at,
    goal,
    route,
    daily_tasks: tasks,
    today_tasks: tasks.filter((task) => task.task_date === today),
  };
}

export function listPlanStages(): PlanStage[] {
  return ["foundation", "core", "application"];
}