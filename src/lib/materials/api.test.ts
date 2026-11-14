import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase } from "@/lib/db";
import { GET as listMaterials, POST as uploadMaterial } from "@/app/api/materials/route";
import { ensurePresetCourse } from "./repository";

function buildPdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 50 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "smart-learning-material-"));
  process.env.DATABASE_FILE = join(workDir, "test.db");
  closeDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env.DATABASE_FILE;
  rmSync(workDir, { recursive: true, force: true });
});

async function upload(fileName: string, content: Buffer, type: string) {
  const body = new FormData();
  body.append("file", new File([Uint8Array.from(content)], fileName, { type }));
  const request = new Request("http://localhost/api/materials", { method: "POST", body });
  const response = await uploadMaterial(request);
  const data = (await response.json()) as {
    ok: boolean;
    parseStatus?: string;
    knowledgePointCount?: number;
    error?: string;
  };
  return { status: response.status, data };
}

describe("知识库接口", () => {
  it("首次打开自动载入预置课程，且不重复导入", async () => {
    const response = await listMaterials();
    const data = (await response.json()) as {
      ok: boolean;
      materials: Array<{ is_preset: number; knowledge_point_count: number }>;
    };

    expect(data.ok).toBe(true);
    const preset = data.materials.find((item) => item.is_preset === 1);
    expect(preset).toBeTruthy();
    expect(preset?.knowledge_point_count ?? 0).toBeGreaterThan(0);

    const again = ensurePresetCourse();
    expect(again.seeded).toBe(false);

    const second = (await (await listMaterials()).json()) as {
      materials: Array<{ is_preset: number }>;
    };
    expect(second.materials.filter((item) => item.is_preset === 1)).toHaveLength(1);
  });

  it("上传 TXT 成功并切出知识点", async () => {
    const text =
      "第一段内容足够长，用于验证上传解析流程是否正常。这里再补充一些说明文字，确保长度达到要求。\n\n第二段内容也足够长，保证能切成知识点，同时补充说明文字用于测试。";
    const { status, data } = await upload("demo.txt", Buffer.from(text, "utf8"), "text/plain");

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.knowledgePointCount ?? 0).toBeGreaterThan(0);
  });

  it("上传 MD 成功", async () => {
    const text =
      "# 课程\n\n## 第一节\n这一节的内容足够长，可以切出一个知识点。再补充一些说明文字，确保超过最小长度限制。";
    const { status, data } = await upload("demo.md", Buffer.from(text, "utf8"), "text/markdown");

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.knowledgePointCount).toBe(1);
  });

  it("上传 PDF 成功", async () => {
    const pdf = buildPdf("PDF knowledge point content used by the upload interface test.");
    const { status, data } = await upload("demo.pdf", pdf, "application/pdf");

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.knowledgePointCount ?? 0).toBeGreaterThan(0);
  });

  it("损坏的 PDF 返回解析失败但不抛 500", async () => {
    const broken = Buffer.from("%PDF-1.4 坏文件", "utf8");
    const { status, data } = await upload("broken.pdf", broken, "application/pdf");

    expect(status).toBe(200);
    expect(data.ok).toBe(false);
    expect(data.parseStatus).toBe("failed");
    expect(data.error).toContain("PDF 解析失败");
  });

  it("PPTX 被拒绝并提示支持范围", async () => {
    const { status, data } = await upload("slides.pptx", Buffer.from("x"), "application/vnd.ms-powerpoint");

    expect(status).toBe(400);
    expect(data.error).toContain("仅支持");
  });
});