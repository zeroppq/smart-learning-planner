import { NextResponse } from "next/server";
import {
  MaterialFormatError,
  createMaterial,
  ensurePresetCourse,
  listMaterials,
} from "@/lib/materials/repository";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function GET() {
  ensurePresetCourse();
  return NextResponse.json({ ok: true, materials: listMaterials() });
}

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "上传内容无法读取，请重试。" }, { status: 400 });
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "请选择一个文件后再上传。" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: "文件是空的，请换一份资料。" }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: "文件超过 10MB，请压缩或拆分后再上传。" },
      { status: 400 },
    );
  }

  try {
    const result = await createMaterial({
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });

    return NextResponse.json({
      ok: result.parseStatus === "success",
      parseStatus: result.parseStatus,
      materialId: result.materialId,
      knowledgePointCount: result.knowledgePointCount,
      error: result.errorMessage,
      materials: listMaterials(),
    });
  } catch (error) {
    if (error instanceof MaterialFormatError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: "上传处理失败，请稍后重试。" },
      { status: 500 },
    );
  }
}