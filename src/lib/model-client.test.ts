import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ModelConfigError,
  ModelRequestError,
  chatCompletion,
  resolveModelName,
} from "./model-client";

interface MockResponse {
  baseUrl: string;
  callCount: () => number;
  requestedModels: () => string[];
}

const servers: Server[] = [];

function startMockServer(
  handler: (requestCount: number, response: ServerResponse) => void,
): Promise<MockResponse> {
  let calls = 0;
  const models: string[] = [];
  const server = createServer((request, response) => {
    calls += 1;
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(raw) as { model?: string };
        if (typeof parsed.model === "string") {
          models.push(parsed.model);
        }
      } catch {
        models.push("");
      }
      handler(calls, response);
    });
  });
  servers.push(server);

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        callCount: () => calls,
        requestedModels: () => models,
      });
    });
  });
}

function setModelEnv(baseUrl: string): void {
  vi.stubEnv("MODEL_API_BASE_URL", baseUrl);
  vi.stubEnv("MODEL_API_KEY", "test-key");
  vi.stubEnv("MODEL_NAME", "default-model");
  vi.stubEnv("MODEL_NAME_PLANNER", "");
  vi.stubEnv("MODEL_NAME_COACH", "");
}

function replyWith(content: string) {
  return (_count: number, response: ServerResponse) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (servers.length > 0) {
    const server = servers.pop();
    if (server) {
      server.close();
    }
  }
});

describe("模型客户端", () => {
  it("未配置时给出中文提示", async () => {
    vi.stubEnv("MODEL_API_BASE_URL", "");
    vi.stubEnv("MODEL_API_KEY", "");
    vi.stubEnv("MODEL_NAME", "");
    vi.stubEnv("MODEL_NAME_PLANNER", "");
    vi.stubEnv("MODEL_NAME_COACH", "");

    await expect(
      chatCompletion([{ role: "user", content: "你好" }]),
    ).rejects.toBeInstanceOf(ModelConfigError);
  });

  it("正常调用返回模型内容", async () => {
    const mock = await startMockServer(replyWith("这是模型回答"));
    setModelEnv(mock.baseUrl);

    const content = await chatCompletion([{ role: "user", content: "你好" }]);

    expect(content).toBe("这是模型回答");
    expect(mock.callCount()).toBe(1);
    expect(mock.requestedModels()).toEqual(["default-model"]);
  });

  it("服务端 500 时自动重试一次", async () => {
    const mock = await startMockServer((count, response) => {
      if (count === 1) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        response.end("临时错误");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: "重试成功" } }] }));
    });
    setModelEnv(mock.baseUrl);

    const content = await chatCompletion([{ role: "user", content: "你好" }], {
      maxRetries: 1,
    });

    expect(content).toBe("重试成功");
    expect(mock.callCount()).toBe(2);
  });

  it("超时后抛出可读错误", async () => {
    const mock = await startMockServer((_count, response) => {
      setTimeout(() => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: "太慢了" } }] }));
      }, 300);
    });
    setModelEnv(mock.baseUrl);

    await expect(
      chatCompletion([{ role: "user", content: "你好" }], {
        timeoutMs: 50,
        maxRetries: 0,
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ModelRequestError && error.message.includes("超时"),
    );
  });

  it("规划师与督学各用各的模型", async () => {
    const mock = await startMockServer(replyWith("按角色返回"));
    setModelEnv(mock.baseUrl);
    vi.stubEnv("MODEL_NAME_PLANNER", "GLM-5.3");
    vi.stubEnv("MODEL_NAME_COACH", "DeepSeek-V4.1-Flash");

    await chatCompletion([{ role: "user", content: "排计划" }], { role: "planner" });
    await chatCompletion([{ role: "user", content: "抽查我" }], { role: "coach" });

    expect(mock.requestedModels()).toEqual(["GLM-5.3", "DeepSeek-V4.1-Flash"]);
  });

  it("角色模型未配置时回落到默认模型", async () => {
    const mock = await startMockServer(replyWith("回落"));
    setModelEnv(mock.baseUrl);

    await chatCompletion([{ role: "user", content: "排计划" }], { role: "planner" });

    expect(mock.requestedModels()).toEqual(["default-model"]);
  });

  it("显式传入 model 时优先级最高", async () => {
    const mock = await startMockServer(replyWith("覆盖"));
    setModelEnv(mock.baseUrl);
    vi.stubEnv("MODEL_NAME_PLANNER", "GLM-5.3");

    await chatCompletion([{ role: "user", content: "你好" }], {
      role: "planner",
      model: "临时指定模型",
    });

    expect(mock.requestedModels()).toEqual(["临时指定模型"]);
  });

  it("按角色解析模型名的规则可单独验证", () => {
    vi.stubEnv("MODEL_NAME", "默认");
    vi.stubEnv("MODEL_NAME_PLANNER", "规划模型");
    vi.stubEnv("MODEL_NAME_COACH", "");

    expect(resolveModelName()).toBe("默认");
    expect(resolveModelName("planner")).toBe("规划模型");
    expect(resolveModelName("coach")).toBe("默认");
  });
});