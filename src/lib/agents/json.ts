export class ModelJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelJsonError";
  }
}

export function extractJson<T = unknown>(raw: string): T {
  const text = raw.trim();
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new ModelJsonError("模型返回的内容里没有可解析的 JSON。");
  }

  const candidate = withoutFence.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(candidate) as T;
  } catch {
    throw new ModelJsonError("模型返回的 JSON 格式不合法。");
  }
}