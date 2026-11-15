import { NextResponse } from "next/server";
import { ModelJsonError } from "@/lib/agents/json";
import {
  PlanValidationError,
  type PlanDraft,
} from "@/lib/agents/planner/schema";
import { generatePlanDraft } from "@/lib/agents/planner/service";
import { ModelConfigError, ModelRequestError } from "@/lib/model-client";
import {
  getActiveGoal,
  getCurrentPlanView,
  listKnowledgePointOptions,
  savePlan,
} from "@/lib/plans/repository";

export async function GET() {
  return NextResponse.json({ ok: true, plan: getCurrentPlanView() ?? null });
}

export async function POST(request: Request) {
  let payload: { goalId?: unknown; answers?: unknown };

  try {
    payload = (await request.json()) as { goalId?: unknown; answers?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求内容无法读取。" }, { status: 400 });
  }

  const goal = getActiveGoal();
  if (!goal) {
    return NextResponse.json(
      { ok: false, error: "还没有学习目标，请先说出你想学什么。" },
      { status: 400 },
    );
  }


  const answers = Array.isArray(payload.answers)
    ? payload.answers
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];

  const points = listKnowledgePointOptions();
  if (points.length === 0) {
    return NextResponse.json(
      { ok: false, error: "知识库里还没有可用知识点，请先上传并把资料解析成功。" },
      { status: 400 },
    );
  }

  const effectiveGoalText =
    answers.length > 0
      ? `${goal.goal_text}\n补充说明：${answers.join("；")}`
      : goal.goal_text;

  let draft: PlanDraft;

  try {
    draft = await generatePlanDraft({
      goalText: effectiveGoalText,
      dailyMinutes: goal.daily_minutes,
      points,
    });
  } catch (error) {
    if (error instanceof PlanValidationError || error instanceof ModelJsonError) {
      return NextResponse.json(
        { ok: false, error: `计划生成结果不可用：${error.message} 原计划保持不变，请重试。` },
        { status: 502 },
      );
    }
    if (error instanceof ModelConfigError) {
      return NextResponse.json(
        { ok: false, error: `模型未配置：${error.message} 原计划保持不变。` },
        { status: 503 },
      );
    }
    if (error instanceof ModelRequestError) {
      return NextResponse.json(
        { ok: false, error: `${error.message} 原计划保持不变。` },
        { status: 502 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "计划生成失败，原计划保持不变，请稍后重试。" },
      { status: 500 },
    );
  }

  try {
    const plan = savePlan({
      goal,
      route: draft.route,
      dailyTasks: draft.daily_tasks,
    });
    return NextResponse.json({ ok: true, plan });
  } catch {
    return NextResponse.json(
      { ok: false, error: "计划保存失败，原计划保持不变，请重试。" },
      { status: 500 },
    );
  }
}