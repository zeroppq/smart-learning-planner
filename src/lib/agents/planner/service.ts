import { chatCompletion, type ChatMessage } from "@/lib/model-client";
import { extractJson } from "@/lib/agents/json";
import {
  PLANNER_CLARIFY_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  buildClarifyUserPrompt,
  buildRouteUserPrompt,
  type PlannerKnowledgePointInput,
} from "./system-prompt";
import {
  buildDailyTasks,
  todayString,
  validateClarifyQuestions,
  validateRoute,
  type PlanDraft,
} from "./schema";

export type PlannerModelCaller = (
  messages: ChatMessage[],
  options: { role: "planner"; timeoutMs: number; maxRetries: number },
) => Promise<string>;

// 实测：GLM-5.3 生成 13 个知识点约 70-83 秒；切换为 deepseek-v4.1-flash-1017 后约 4 秒。
// 因此规划超时设为 60 秒并保留一次重试，澄清问题限时 20 秒且不重试，失败时返回空列表。
const ROUTE_MODEL_OPTIONS = {
  role: "planner" as const,
  timeoutMs: 60_000,
  maxRetries: 1,
};
const CLARIFY_MODEL_OPTIONS = {
  role: "planner" as const,
  timeoutMs: 20_000,
  maxRetries: 0,
};

export async function generateClarifyingQuestions(
  input: { goalText: string; dailyMinutes: number; pointCount: number },
  callModel: PlannerModelCaller = chatCompletion,
): Promise<string[]> {
  try {
    const content = await callModel(
      [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "system", content: PLANNER_CLARIFY_PROMPT },
        {
          role: "user",
          content: buildClarifyUserPrompt({
            goalText: input.goalText,
            dailyMinutes: input.dailyMinutes,
            pointCount: input.pointCount,
          }),
        },
      ],
      CLARIFY_MODEL_OPTIONS,
    );

    return validateClarifyQuestions(extractJson(content));
  } catch {
    // 澄清问题不是闭环必需项：生成失败时返回空列表，允许用户直接生成计划。
    return [];
  }
}

export async function generatePlanDraft(
  input: {
    goalText: string;
    dailyMinutes: number;
    points: PlannerKnowledgePointInput[];
    startDate?: string;
  },
  callModel: PlannerModelCaller = chatCompletion,
): Promise<PlanDraft> {
  const validIds = new Set(input.points.map((point) => point.knowledgePointId));

  const content = await callModel(
    [
      { role: "system", content: PLANNER_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildRouteUserPrompt({
          goalText: input.goalText,
          dailyMinutes: input.dailyMinutes,
          points: input.points,
        }),
      },
    ],
    ROUTE_MODEL_OPTIONS,
  );

  const route = validateRoute(extractJson(content), validIds);
  const dailyTasks = buildDailyTasks({
    route,
    startDate: input.startDate ?? todayString(),
    dailyMinutes: input.dailyMinutes,
  });

  return { route, daily_tasks: dailyTasks };
}