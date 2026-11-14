import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelConfigError, ModelRequestError, chatCompletion } from "./model-client";

const servers: Server[] = [];

function startMockServer(
  handler: (requestCount: number, response: import("node:http").ServerResponse) => void,
): Promise<{ baseUrl: string; callCount: () => number }> {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    request.resume();
    handler(calls, response);
  });
  servers.push(server);

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        callCount: () => calls,
      });
    });
  });
}

function setModelEnv(baseUrl: string): void {
  vi.stubEnv("MODEL_API_BASE_URL", baseUrl);
  vi.stubEnv("MODEL_API_KEY", "test-key");
  vi.stubEnv("MODEL_NAME", "test-model");
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

    await expect(
      chatCompletion([{ role: "user", content: "你好" }]),
    ).rejects.toBeInstanceOf(ModelConfigError);
  });

  it("正常调用返回模型内容", async () => {
    const mock = await startMockServer((_count, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ choices: [{ message: { content: "这是模型回答" } }] }),
      );
    });
    setModelEnv(mock.baseUrl);

    const content = await chatCompletion([{ role: "user", content: "你好" }]);

    expect(content).toBe("这是模型回答");
    expect(mock.callCount()).toBe(1);
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
});