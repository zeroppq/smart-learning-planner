export type PlanStage = "foundation" | "core" | "application";

export interface PlanRouteNode {
  knowledge_point_id: string;
  prerequisite_point_id: string | null;
  node_order: number;
  stage: PlanStage;
}

export interface PlanDailyTask {
  task_date: string;
  knowledge_point_id: string;
  estimated_minutes: number;
}

export interface PlanDraft {
  route: PlanRouteNode[];
  daily_tasks: PlanDailyTask[];
}

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

const VALID_STAGES: PlanStage[] = ["foundation", "core", "application"];
export const PLAN_PERIOD_DAYS = 14;
export const MAX_POINTS_PER_DAY = 3;
export const MAX_ROUTE_POINTS = PLAN_PERIOD_DAYS * MAX_POINTS_PER_DAY;

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface RawRouteNode {
  knowledge_point_id?: unknown;
  prerequisite_point_id?: unknown;
  stage?: unknown;
}

export function validateRoute(
  raw: unknown,
  validPointIds: Set<string>,
): PlanRouteNode[] {
  if (!raw || typeof raw !== "object") {
    throw new PlanValidationError("规划师返回的内容不是对象。");
  }

  const route = (raw as { route?: unknown }).route;
  if (!Array.isArray(route) || route.length === 0) {
    throw new PlanValidationError("规划师没有返回学习路线。");
  }

  const seen = new Set<string>();
  const nodes: PlanRouteNode[] = [];

  for (const item of route as RawRouteNode[]) {
    const pointId = typeof item.knowledge_point_id === "string" ? item.knowledge_point_id : "";
    if (!pointId) {
      throw new PlanValidationError("路线中存在缺少知识点 ID 的节点。");
    }
    if (!validPointIds.has(pointId)) {
      throw new PlanValidationError("规划师引用了知识库里不存在的知识点，已放弃本次生成。");
    }
    if (seen.has(pointId)) {
      continue;
    }
    seen.add(pointId);

    let prerequisite =
      typeof item.prerequisite_point_id === "string" && item.prerequisite_point_id.trim()
        ? item.prerequisite_point_id.trim()
        : null;

    if (prerequisite && (prerequisite === pointId || !validPointIds.has(prerequisite))) {
      // 模型偶尔会写错前置 ID：丢弃这条依赖比整份计划作废更稳，知识点本身仍然保留。
      prerequisite = null;
    }

    const stage = VALID_STAGES.includes(item.stage as PlanStage)
      ? (item.stage as PlanStage)
      : "core";

    nodes.push({
      knowledge_point_id: pointId,
      prerequisite_point_id: prerequisite,
      node_order: nodes.length + 1,
      stage,
    });
  }

  if (nodes.length === 0) {
    throw new PlanValidationError("规划师返回的路线为空。");
  }

  assertNoCycle(nodes);

  return nodes.slice(0, MAX_ROUTE_POINTS).map((node, index) => ({
    ...node,
    node_order: index + 1,
  }));
}

function assertNoCycle(nodes: PlanRouteNode[]): void {
  const prerequisites = new Map<string, string | null>();
  for (const node of nodes) {
    prerequisites.set(node.knowledge_point_id, node.prerequisite_point_id);
  }

  for (const node of nodes) {
    const visited = new Set<string>([node.knowledge_point_id]);
    let cursor = node.prerequisite_point_id;
    let guard = 0;

    while (cursor && guard < nodes.length + 1) {
      if (visited.has(cursor)) {
        throw new PlanValidationError("规划师给出的前置关系形成了环，已放弃本次生成。");
      }
      visited.add(cursor);
      cursor = prerequisites.get(cursor) ?? null;
      guard += 1;
    }
  }
}

export function buildDailyTasks(input: {
  route: PlanRouteNode[];
  startDate: string;
  dailyMinutes: number;
}): PlanDailyTask[] {
  const { route, startDate, dailyMinutes } = input;
  const perDay = Math.min(
    MAX_POINTS_PER_DAY,
    Math.max(Math.ceil(route.length / PLAN_PERIOD_DAYS), Math.floor(dailyMinutes / 15)),
  );
  const tasks: PlanDailyTask[] = [];

  route.forEach((node, index) => {
    const dayOffset = Math.floor(index / perDay);
    const tasksToday = Math.min(perDay, route.length - dayOffset * perDay);
    const minutes = Math.max(15, Math.round(dailyMinutes / Math.max(1, tasksToday)));

    tasks.push({
      task_date: addDays(startDate, Math.min(dayOffset, PLAN_PERIOD_DAYS - 1)),
      knowledge_point_id: node.knowledge_point_id,
      estimated_minutes: minutes,
    });
  });

  return tasks;
}

export function validateClarifyQuestions(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const questions = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 100))
    .slice(0, 3);
}