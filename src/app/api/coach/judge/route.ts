import { NextResponse } from "next/server";
import { ModelConfigError, ModelRequestError } from "@/lib/model-client";
import { buildJudgeStandard, formatStandardForPrompt } from "@/lib/agents/coach/standard";
import {
  generateQuestion,
  judgeAnswer,
  type JudgeVerdict,
} from "@/lib/agents/coach/service";
import {
  consumeRejudge,
  getMastery,
  getPointContext,
  getReferenceNotes,
  recordLayerResult,
  recordStudySession,
} from "@/lib/agents/coach/repository";

const LAYERS = ["explain", "practice", "apply"] as const;
type Layer = (typeof LAYERS)[number];

function nextLayerAfter(layer: Layer, verdict: JudgeVerdict["verdict"]): Layer | "done" {
  if (verdict !== "pass") {
    return layer;
  }
  if (layer === "explain") {
    return "practice";
  }
  if (layer === "practice") {
    return "apply";
  }
  return "done";
}

export async function POST(request: Request) {
  let payload: {
    knowledgePointId?: unknown;
    layer?: unknown;
    question?: unknown;
    answer?: unknown;
    rejudge?: unknown;
    rejudgeNote?: unknown;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "请求内容无法读取。" }, { status: 400 });
  }

  const knowledgePointId =
    typeof payload.knowledgePointId === "string" ? payload.knowledgePointId : "";
  const point = getPointContext(knowledgePointId);
  if (!point) {
    return NextResponse.json({ ok: false, error: "知识点不存在。" }, { status: 404 });
  }

  const layer = LAYERS.includes(payload.layer as Layer) ? (payload.layer as Layer) : null;
  if (!layer) {
    return NextResponse.json({ ok: false, error: "判定层不合法。" }, { status: 400 });
  }

  const isRejudge = payload.rejudge === true;
  const rejudgeNote = typeof payload.rejudgeNote === "string" ? payload.rejudgeNote.trim() : "";
  const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  const standard = buildJudgeStandard(point);
  const standardText = formatStandardForPrompt(standard);

  if (isRejudge) {
    if (!consumeRejudge(knowledgePointId)) {
      return NextResponse.json(
        { ok: false, error: "该知识点的重判机会已用完。" },
        { status: 400 },
      );
    }
    if (rejudgeNote.length < 2) {
      return NextResponse.json(
        { ok: false, error: "申请重判时需要补充说明，方便督学重新判断。" },
        { status: 400 },
      );
    }
  }


  if (!question) {
    if (layer === "explain") {
      return NextResponse.json(
        { ok: false, error: "缺少复述要求，请重新开始本次学习。" },
        { status: 400 },
      );
    }

    try {
      const generated = await generateQuestion(point, layer, getReferenceNotes(point));
      return NextResponse.json({
        ok: true,
        needAnswer: true,
        layer,
        question: generated.question,
        expectedPoints: generated.expectedPoints,
        standard,
        standardText,
      });
    } catch (error) {
      if (error instanceof ModelConfigError) {
        return NextResponse.json(
          { ok: false, error: `模型未配置：${error.message}` },
          { status: 503 },
        );
      }
      if (error instanceof ModelRequestError) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
      }
      return NextResponse.json(
        { ok: false, error: "题目生成失败，请重试。" },
        { status: 500 },
      );
    }
  }

  if (!answer) {
    return NextResponse.json({ ok: false, error: "请先作答再提交判定。" }, { status: 400 });
  }

  const beforeMastery = getMastery(knowledgePointId);
  const previousResult =
    layer === "explain"
      ? beforeMastery?.explain_result ?? "not_attempted"
      : layer === "practice"
        ? beforeMastery?.practice_result ?? "not_attempted"
        : beforeMastery?.apply_result ?? "not_attempted";

  let verdict: JudgeVerdict;
  try {
    verdict = await judgeAnswer(point, {
      layer,
      question,
      answer,
      standardItems: standard[layer],
      rejudgeNote: isRejudge ? rejudgeNote : undefined,
      referenceNotes: getReferenceNotes(point),
    });
  } catch (error) {
    console.error("判定失败：", error instanceof Error ? error.message : String(error));
    if (error instanceof ModelConfigError) {
      return NextResponse.json(
        { ok: false, error: `模型未配置：${error.message}` },
        { status: 503 },
      );
    }
    if (error instanceof ModelRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
    }
    return NextResponse.json(
      { ok: false, error: "判定未完成，本次状态保持不变，请重试。" },
      { status: 500 },
    );
  }

  const mastery = recordLayerResult({
    knowledgePointId,
    layer,
    result: verdict.verdict,
  });
  recordStudySession({ knowledgePointId, stage: layer });

  const next = nextLayerAfter(layer, verdict.verdict);

  return NextResponse.json({
    ok: true,
    needAnswer: false,
    layer,
    verdict: verdict.verdict,
    retryPass:
      verdict.verdict === "pass" &&
      (previousResult === "fail" || previousResult === "partial"),
    feedback: verdict.feedback,
    gaps: verdict.gaps,
    suggestions: verdict.suggestions,
    standard,
    standardText,
    mastery,
    rejudgeUsed: getMastery(knowledgePointId)?.rejudge_used ?? 0,
    nextLayer: next,
  });
}