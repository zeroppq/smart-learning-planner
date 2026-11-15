import { NextResponse } from "next/server";
import { buildDailyTasks, todayString, type PlanRouteNode } from "@/lib/agents/planner/schema";
import { getActiveGoal, getCurrentPlanView, savePlan } from "@/lib/plans/repository";

interface TaskSummary {
  totalDays: number;
  maxTasksPerDay: number;
  minutesPerTask: number[];
}

function summarizeTasks(
  tasks: Array<{ task_date: string; estimated_minutes: number }>,
): TaskSummary {
  const perDay = new Map<string, number>();
  const minutes = new Set<number>();
  for (const task of tasks) {
    perDay.set(task.task_date, (perDay.get(task.task_date) ?? 0) + 1);
    minutes.add(task.estimated_minutes);
  }
  return {
    totalDays: perDay.size,
    maxTasksPerDay: perDay.size > 0 ? Math.max(...perDay.values()) : 0,
    minutesPerTask: Array.from(minutes).sort((a, b) => a - b),
  };
}

export async function POST(request: Request) {
  let payload: { confirm?: unknown };

  try {
    payload = (await request.json()) as { confirm?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求内容无法读取。" }, { status: 400 });
  }

  const confirm = payload.confirm === true;
  const goal = getActiveGoal();
  if (!goal) {
    return NextResponse.json(
      { ok: false, error: "还没有学习目标，请先说出你想学什么。" },
      { status: 400 },
    );
  }

  const plan = getCurrentPlanView();
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: "还没有学习计划，先生成计划再调整每日时长。" },
      { status: 400 },
    );
  }

  const route: PlanRouteNode[] = plan.route.map((node) => ({
    knowledge_point_id: node.knowledge_point_id,
    prerequisite_point_id: node.prerequisite_point_id,
    node_order: node.node_order,
    stage: node.stage,
  }));

  const nextTasks = buildDailyTasks({
    route,
    startDate: todayString(),
    dailyMinutes: goal.daily_minutes,
  });

  const titleMap = new Map(plan.route.map((node) => [node.knowledge_point_id, node.point_title]));
  const before = summarizeTasks(plan.daily_tasks);
  const after = summarizeTasks(nextTasks);

  if (!confirm) {
    const preview = nextTasks.map((task) => ({
      task_date: task.task_date,
      point_title: titleMap.get(task.knowledge_point_id) ?? task.knowledge_point_id,
      estimated_minutes: task.estimated_minutes,
    }));

    return NextResponse.json({
      ok: true,
      confirm: false,
      dailyMinutes: goal.daily_minutes,
      before,
      after,
      preview,
    });
  }

  try {
    const saved = savePlan({ goal, route, dailyTasks: nextTasks });
    return NextResponse.json({
      ok: true,
      confirm: true,
      planVersion: saved.plan_version,
      dailyMinutes: goal.daily_minutes,
      before,
      after,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "重排没有保存成功，原计划保持不变，请重试。" },
      { status: 500 },
    );
  }
}
