import { NextResponse } from "next/server";
import { ModelConfigError, ModelRequestError } from "@/lib/model-client";
import { buildJudgeStandard, formatStandardForPrompt } from "@/lib/agents/coach/standard";
import { generateLecture } from "@/lib/agents/coach/service";
import {
  getOrCreateMastery,
  getPointContext,
  recordStudySession,
} from "@/lib/agents/coach/repository";

export async function POST(request: Request) {
  let payload: { knowledgePointId?: unknown };

  try {
    payload = (await request.json()) as { knowledgePointId?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求内容无法读取。" }, { status: 400 });
  }

  const knowledgePointId =
    typeof payload.knowledgePointId === "string" ? payload.knowledgePointId : "";
  const point = getPointContext(knowledgePointId);

  if (!point) {
    return NextResponse.json({ ok: false, error: "知识点不存在。" }, { status: 404 });
  }

  const standard = buildJudgeStandard(point);
  const standardText = formatStandardForPrompt(standard);

  let lecture: string;
  try {
    lecture = await generateLecture(point, standardText);
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
      { ok: false, error: "督学讲解生成失败，请重试。" },
      { status: 500 },
    );
  }

  const mastery = getOrCreateMastery(knowledgePointId);
  recordStudySession({ knowledgePointId, stage: "lecture" });

  return NextResponse.json({
    ok: true,
    point: {
      knowledgePointId: point.knowledgePointId,
      pointTitle: point.pointTitle,
      chapterName: point.chapterName,
      materialName: point.materialName,
      paragraphIndex: point.paragraphIndex,
      paragraphText: point.paragraphText,
    },
    standard,
    standardText,
    lecture,
    mastery,
    next: {
      layer: "explain",
      question: `请用你自己的话讲清楚「${point.pointTitle}」是什么、解决什么问题，并举一个例子。`,
    },
  });
}