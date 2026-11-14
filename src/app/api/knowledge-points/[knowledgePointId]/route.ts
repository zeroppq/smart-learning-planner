import { NextResponse } from "next/server";
import { getKnowledgePointDetail } from "@/lib/materials/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ knowledgePointId: string }> },
) {
  const { knowledgePointId } = await context.params;
  const detail = getKnowledgePointDetail(knowledgePointId);

  if (!detail) {
    return NextResponse.json({ ok: false, error: "知识点不存在。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, knowledgePoint: detail });
}