import { chatCompletion, type ChatMessage } from "@/lib/model-client";
import { extractJson } from "@/lib/agents/json";
import {
  COACH_ASK_PROMPT,
  COACH_JUDGE_PROMPT,
  COACH_LECTURE_PROMPT,
  COACH_QUESTION_PROMPT,
  COACH_REVIEW_PROMPT,
  COACH_SYSTEM_PROMPT,
  buildAskUserPrompt,
  buildJudgeUserPrompt,
  buildLectureUserPrompt,
  buildQuestionUserPrompt,
  buildReviewUserPrompt,
  type CoachLayerInput,
  type CoachPointContext,
} from "./system-prompt";

export type CoachModelCaller = (
  messages: ChatMessage[],
  options: { role: "coach"; timeoutMs: number; maxRetries: number },
) => Promise<string>;

// 督学属于高频交互，实测新模型毫秒级返回，30 秒足够，并保留一次重试。
const COACH_OPTIONS = { role: "coach" as const, timeoutMs: 30_000, maxRetries: 1 };

export interface JudgeVerdict {
  verdict: "pass" | "partial" | "fail";
  feedback: string;
  gaps: string[];
}

export interface GeneratedQuestion {
  question: string;
  expectedPoints: string[];
}

const VERDICTS = ["pass", "partial", "fail"] as const;

export function validateVerdict(raw: unknown): JudgeVerdict {
  if (!raw || typeof raw !== "object") {
    throw new Error("督学返回的判定不是对象。");
  }
  const data = raw as { verdict?: unknown; feedback?: unknown; gaps?: unknown };
  const verdict = VERDICTS.includes(data.verdict as (typeof VERDICTS)[number])
    ? (data.verdict as JudgeVerdict["verdict"])
    : null;

  if (!verdict) {
    throw new Error("督学没有给出明确的通过或不通过结论。");
  }

  const feedback = typeof data.feedback === "string" && data.feedback.trim() ? data.feedback.trim() : "已记录本次判定。";
  const gaps = Array.isArray(data.gaps)
    ? data.gaps
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 5)
    : [];

  return { verdict, feedback, gaps };
}

export async function generateLecture(
  point: CoachPointContext,
  standardText: string,
  callModel: CoachModelCaller = chatCompletion,
): Promise<string> {
  const content = await callModel(
    [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      { role: "system", content: COACH_LECTURE_PROMPT },
      { role: "user", content: buildLectureUserPrompt(point, standardText) },
    ],
    COACH_OPTIONS,
  );

  return content.trim();
}

export function validateQuestion(raw: unknown): GeneratedQuestion {
  if (!raw || typeof raw !== "object") {
    throw new Error("督学返回的题目不是对象。");
  }
  const data = raw as { question?: unknown; expected_points?: unknown };
  const question = typeof data.question === "string" ? data.question.trim() : "";

  if (question.length < 5) {
    throw new Error("督学没有给出有效题目。");
  }

  const expectedPoints = Array.isArray(data.expected_points)
    ? data.expected_points
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 5)
    : [];

  return { question, expectedPoints };
}

export async function generateQuestion(
  point: CoachPointContext,
  layer: "practice" | "apply",
  referenceNotes?: string,
  callModel: CoachModelCaller = chatCompletion,
): Promise<GeneratedQuestion> {
  const content = await callModel(
    [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      { role: "system", content: COACH_QUESTION_PROMPT },
      { role: "user", content: buildQuestionUserPrompt(point, layer, referenceNotes) },
    ],
    COACH_OPTIONS,
  );

  return validateQuestion(extractJson(content));
}

export async function judgeAnswer(
  point: CoachPointContext,
  input: CoachLayerInput,
  callModel: CoachModelCaller = chatCompletion,
): Promise<JudgeVerdict> {
  const content = await callModel(
    [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      { role: "system", content: COACH_JUDGE_PROMPT },
      { role: "user", content: buildJudgeUserPrompt(point, input) },
    ],
    COACH_OPTIONS,
  );

  return validateVerdict(extractJson(content));
}

export async function generateReviewQuestion(
  point: CoachPointContext,
  callModel: CoachModelCaller = chatCompletion,
): Promise<string> {
  try {
    const content = await callModel(
      [
        { role: "system", content: COACH_SYSTEM_PROMPT },
        { role: "system", content: COACH_REVIEW_PROMPT },
        { role: "user", content: buildReviewUserPrompt(point) },
      ],
      COACH_OPTIONS,
    );
    const data = extractJson<{ question?: unknown }>(content);
    const question = typeof data.question === "string" ? data.question.trim() : "";
    if (question.length >= 5) {
      return question;
    }
  } catch {
    // 抽查题生成失败时退回固定问法，保证抽查可用。
  }

  return `请用你自己的话复述「${point.pointTitle}」，并说明它能解决什么问题。`;
}

export async function answerWithKnowledge(
  question: string,
  paragraphs: Array<{ materialName: string; paragraphIndex: number; paragraphText: string }>,
  callModel: CoachModelCaller = chatCompletion,
): Promise<string> {
  if (paragraphs.length === 0) {
    return "当前资料未覆盖这个问题，建议补充相关资料或换个问法。";
  }

  const content = await callModel(
    [
      { role: "system", content: COACH_SYSTEM_PROMPT },
      { role: "system", content: COACH_ASK_PROMPT },
      { role: "user", content: buildAskUserPrompt(question, paragraphs) },
    ],
    COACH_OPTIONS,
  );

  return content.trim();
}