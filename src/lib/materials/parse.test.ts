import { describe, expect, it } from "vitest";
import { MaterialParseError, detectFormat, parseMaterial } from "./parse";

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

describe("资料格式识别", () => {
  it("识别三种受支持格式", () => {
    expect(detectFormat("a.txt")).toBe("txt");
    expect(detectFormat("b.MD")).toBe("md");
    expect(detectFormat("c.pdf")).toBe("pdf");
  });

  it("不支持 PPTX / DOCX", () => {
    expect(detectFormat("a.pptx")).toBeNull();
    expect(detectFormat("b.docx")).toBeNull();
  });
});

describe("资料解析", () => {
  it("TXT 解析成功", async () => {
    const text =
      "第一段内容比较长，用来验证解析是否成功。这里再补充一些说明文字，确保总长度超过最小限制要求。\n\n第二段内容同样足够长，保证超过最小长度限制，也补充一些说明文字用于验证。";
    const result = await parseMaterial("demo.txt", Buffer.from(text, "utf8"));

    expect(result.format).toBe("txt");
    expect(result.paragraphs).toHaveLength(2);
  });

  it("MD 解析成功并保留标题段落", async () => {
    const text =
      "# 第一章\n\n## 1.1 小节\n这是小节正文，内容需要足够长才能通过最小长度校验，因此这里再补充一些说明文字，确保解析成功。";
    const result = await parseMaterial("demo.md", Buffer.from(text, "utf8"));

    expect(result.format).toBe("md");
    expect(result.paragraphs[0]).toBe("# 第一章");
  });

  it("PDF 解析成功", async () => {
    const pdf = buildPdf("Hello PDF knowledge point content for automated testing only.");
    const result = await parseMaterial("demo.pdf", pdf);

    expect(result.format).toBe("pdf");
    expect(result.text).toContain("Hello PDF knowledge point content");
  });

  it("损坏的 PDF 标记为解析失败并给出中文提示", async () => {
    const broken = Buffer.from("%PDF-1.4\n这不是一个完整的 PDF", "utf8");

    await expect(parseMaterial("broken.pdf", broken)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof MaterialParseError && error.message.includes("PDF 解析失败"),
    );
  });

  it("PPTX 直接拒绝并说明支持范围", async () => {
    await expect(parseMaterial("slides.pptx", Buffer.from("x"))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof MaterialParseError && error.message.includes("仅支持"),
    );
  });
});