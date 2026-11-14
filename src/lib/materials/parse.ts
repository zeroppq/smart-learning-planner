export type MaterialFormat = "txt" | "md" | "pdf";

export class MaterialParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialParseError";
  }
}

export interface ParsedMaterial {
  format: MaterialFormat;
  text: string;
  paragraphs: string[];
}

const MIN_TEXT_LENGTH = 50;

export function detectFormat(fileName: string): MaterialFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) {
    return "txt";
  }
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "md";
  }
  if (lower.endsWith(".pdf")) {
    return "pdf";
  }
  return null;
}

export function splitParagraphs(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const paragraphs: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    let buffer: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#{1,6}\s+/.test(trimmed)) {
        if (buffer.length > 0) {
          paragraphs.push(buffer.join("\n").trim());
          buffer = [];
        }
        paragraphs.push(trimmed);
      } else {
        buffer.push(line);
      }
    }

    if (buffer.length > 0) {
      const joined = buffer.join("\n").trim();
      if (joined) {
        paragraphs.push(joined);
      }
    }
  }

  return paragraphs.filter(Boolean);
}

export async function parseMaterial(
  fileName: string,
  data: Buffer,
): Promise<ParsedMaterial> {
  const format = detectFormat(fileName);
  if (!format) {
    throw new MaterialParseError("仅支持 TXT、MD、PDF 三种格式。");
  }

  let text = "";

  if (format === "pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
    } catch {
      throw new MaterialParseError("PDF 解析失败，建议改用 MD 或 TXT 格式。");
    }
  } else {
    text = data.toString("utf8");
  }

  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();

  if (text.length < MIN_TEXT_LENGTH) {
    throw new MaterialParseError("提取到的文字太少，无法切分知识点。");
  }

  return {
    format,
    text,
    paragraphs: splitParagraphs(text),
  };
}