import { NextResponse } from "next/server";
import {
  getMaterial,
  listKnowledgePoints,
} from "@/lib/materials/repository";

export async function GET(
  _request: Request,
  context: { params: Promise<{ materialId: string }> },
) {
  const { materialId } = await context.params;
  const material = getMaterial(materialId);

  if (!material) {
    return NextResponse.json({ ok: false, error: "资料不存在。" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    material,
    knowledgePoints: listKnowledgePoints(materialId),
  });
}