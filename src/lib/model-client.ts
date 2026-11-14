export type AgentRole = "planner" | "coach";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  /** 直接指定模型名，优先级最高 */
  model?: string;
  /** 按智能体选择模型，优先级低于 model、高于默认模型 */
  role?: AgentRole;
}

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

export class ModelRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRequestError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

export function resolveModelName(role?: AgentRole): string {
  const fallback = (process.env.MODEL_NAME ?? "").trim();

  if (role === "planner") {
    return (process.env.MODEL_NAME_PLANNER ?? "").trim() || fallback;
  }
  if (role === "coach") {
    return (process.env.MODEL_NAME_COACH ?? "").trim() || fallback;
  }
  return fallback;
}

export function getModelConfig(role?: AgentRole): ModelConfig {
  return {
    baseUrl: (process.env.MODEL_API_BASE_URL ?? "").trim().replace(/\/+$/, ""),
    apiKey: (process.env.MODEL_API_KEY ?? "").trim(),
    model: resolveModelName(role),
  };
}

export function isModelConfigured(role?: AgentRole): boolean {
  const config = getModelConfig(role);
  return Boolean(config.baseUrl && config.apiKey && config.model);
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const { baseUrl, apiKey } = getModelConfig();
  const selectedModel = (options.model ?? "").trim() || resolveModelName(options.role);

  if (!baseUrl || !apiKey || !selectedModel) {
    throw new ModelConfigError(
      "模型服务尚未配置，请设置 MODEL_API_BASE_URL、MODEL_API_KEY，以及 MODEL_NAME（或 MODEL_NAME_PLANNER / MODEL_NAME_COACH）。",
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const fetchImpl = options.fetchImpl ?? fetch;

  let lastError: ModelRequestError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: selectedModel, messages, stream: false }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const detail = bodyText ? `：${bodyText.slice(0, 200)}` : "";
        const error = new ModelRequestError(`模型服务返回错误（${response.status}）${detail}`);
        if (response.status >= 500 && attempt < maxRetries) {
          lastError = error;
          continue;
        }
        throw error;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = data.choices?.[0]?.message?.content;

      if (typeof content !== "string" || content.trim() === "") {
        throw new ModelRequestError("模型返回内容为空，请稍后重试。");
      }

      return content;
    } catch (error) {
      if (error instanceof ModelRequestError) {
        throw error;
      }

      const aborted = error instanceof Error && error.name === "AbortError";
      lastError = aborted
        ? new ModelRequestError(`模型调用超时（${timeoutMs} 毫秒），请稍后重试。`)
        : new ModelRequestError("模型调用失败，请检查网络与接口地址后重试。");

      if (attempt >= maxRetries) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new ModelRequestError("模型调用失败，请稍后重试。");
}