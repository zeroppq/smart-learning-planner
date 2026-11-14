import { NextResponse } from "next/server";
import { ModelConfigError, ModelRequestError } from "@/lib/model-client";
import { answerWithKnowledge } from "@/lib/agents/coach/service";
import { getPointContext } from "@/lib/agents/coach/repository";
import { retrieveParagraphs } from "@/lib/retriever";

export async function POST(request: Request) {
  let payload: { question?: unknown; knowledgePointId?: unknown };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "请求内容无法读取。" }, { status: 400 });
  }

  const question = typeof payload.question === "string" ? payload.question.trim() : "";
  if (question.length < 2) {
    return NextResponse.json({ ok: false, error: "请先写下你的问题。" }, { status: 400 });
  }

  const retrieved = retrieveParagraphs(question, { limit: 3 });
  const currentPoint =
    typeof payload.knowledgePointId === "string"
      ? getPointContext(payload.knowledgePointId)
      : undefined;

  const paragraphs = [...retrieved];
  if (currentPoint && !paragraphs.some((item) => item.knowledgePointId === currentPoint.knowledgePointId)) {
    paragraphs.unshift({
      knowledgePointId: currentPoint.knowledgePointId,
      pointTitle: currentPoint.pointTitle,
      chapterName: currentPoint.chapterName,
      paragraphText: currentPoint.paragraphText,
      paragraphIndex: currentPoint.paragraphIndex,
      materialName: currentPoint.materialName,
      score: 0,
    });
  }

  try {
    const answer = await answerWithKnowledge(
      question,
      paragraphs.map((item) => ({
        materialName: item.materialName,
        paragraphIndex: item.paragraphIndex,
        paragraphText: item.paragraphText,
      })),
    );

    return NextResponse.json({
      ok: true,
      answer,
      hasEvidence: paragraphs.length > 0,
      sources: paragraphs.map((item) => ({
        knowledgePointId: item.knowledgePointId,
        pointTitle: item.pointTitle,
        materialName: item.materialName,
        paragraphIndex: item.paragraphIndex,
      })),
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
    return NextResponse.json({ ok: false, error: "答疑暂时不可用，请稍后重试。" }, { status: 500 });
  }
}