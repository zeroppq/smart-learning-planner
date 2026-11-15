import { NextResponse } from "next/server";
import { generateClarifyingQuestions } from "@/lib/agents/planner/service";
import {
  createOrReplaceActiveGoal,
  getActiveGoal,
  listKnowledgePointOptions,
  updateActiveGoalDailyMinutes,
} from "@/lib/plans/repository";

export async function POST(request: Request) {
  let payload: { goalText?: unknown; dailyMinutes?: unknown };

  try {
    payload = (await request.json()) as { goalText?: unknown; dailyMinutes?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求内容无法读取。" }, { status: 400 });
  }

  const goalText = typeof payload.goalText === "string" ? payload.goalText.trim() : "";
  const dailyMinutes = Number(payload.dailyMinutes ?? 40);

  if (goalText.length < 2) {
    return NextResponse.json({ ok: false, error: "请用一句话说明你想学什么。" }, { status: 400 });
  }
  if (goalText.length > 200) {
    return NextResponse.json({ ok: false, error: "目标描述请控制在 200 字以内。" }, { status: 400 });
  }
  if (!Number.isFinite(dailyMinutes) || dailyMinutes < 10 || dailyMinutes > 240) {
    return NextResponse.json(
      { ok: false, error: "每天可用时长请填 10 到 240 分钟之间。" },
      { status: 400 },
    );
  }

  const existing = getActiveGoal();
  const goal =
    existing && existing.goal_text.trim() === goalText
      ? (updateActiveGoalDailyMinutes(Math.round(dailyMinutes)) ?? existing)
      : createOrReplaceActiveGoal({ goalText, dailyMinutes: Math.round(dailyMinutes) });
  const points = listKnowledgePointOptions();

  const questions = await generateClarifyingQuestions({
    goalText: goal.goal_text,
    dailyMinutes: goal.daily_minutes,
    pointCount: points.length,
  });

  return NextResponse.json({ ok: true, goal, questions });
}