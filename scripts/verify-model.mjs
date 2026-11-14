import { createServer } from "node:http";
import { chatCompletion, ModelConfigError, ModelRequestError } from "../src/lib/model-client.ts";

function describeError(error) {
  if (error instanceof ModelConfigError) {
    return `[配置错误] ${error.message}`;
  }
  if (error instanceof ModelRequestError) {
    return `[请求错误] ${error.message.slice(0, 200)}`;
  }
  return `[未知错误] ${String(error).slice(0, 200)}`;
}

function report(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
  return { name, ok, detail };
}

function maskBaseUrl(value) {
  return value.replace(/^(https?:\/\/[^/]+).*$/, "$1/...");
}

async function withMockServer(handler) {
  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    request.resume();
    handler(calls, response);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    callCount: () => calls,
    close: () => server.close(),
  };
}

async function main() {
  const results = [];
  const originalBaseUrl = process.env.MODEL_API_BASE_URL ?? "";
  const originalApiKey = process.env.MODEL_API_KEY ?? "";
  const originalModel = process.env.MODEL_NAME ?? "";

  console.log("CONFIG | baseUrl 主机已隐藏 |", maskBaseUrl(originalBaseUrl));
  console.log("CONFIG | 默认模型名 |", originalModel || "(空)");
  console.log("CONFIG | 密钥是否已配置 |", originalApiKey ? "是" : "否");

  try {
    const started = Date.now();
    const content = await chatCompletion(
      [{ role: "user", content: "只回复两个字：收到" }],
      { timeoutMs: 30_000 },
    );
    results.push(
      report("1 正常返回", content.trim().length > 0, `${Date.now() - started}ms，返回长度 ${content.length}`),
    );
  } catch (error) {
    results.push(report("1 正常返回", false, describeError(error)));
  }

  try {
    await chatCompletion([{ role: "user", content: "你好" }], { timeoutMs: 1, maxRetries: 0 });
    results.push(report("2 超时兜底", false, "预期超时但没有报错"));
  } catch (error) {
    const ok = error instanceof ModelRequestError && error.message.includes("超时");
    results.push(report("2 超时兜底", ok, describeError(error)));
  }

  const mock = await withMockServer((count, response) => {
    if (count === 1) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end("mock 500");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "重试成功" } }] }));
  });

  try {
    process.env.MODEL_API_BASE_URL = mock.baseUrl;
    const content = await chatCompletion([{ role: "user", content: "你好" }], { maxRetries: 1 });
    results.push(
      report("3 重试一次", content === "重试成功" && mock.callCount() === 2, `调用 ${mock.callCount()} 次`),
    );
  } catch (error) {
    results.push(report("3 重试一次", false, describeError(error)));
  } finally {
    process.env.MODEL_API_BASE_URL = originalBaseUrl;
    mock.close();
  }

  try {
    process.env.MODEL_API_KEY = "";
    await chatCompletion([{ role: "user", content: "你好" }]);
    results.push(report("4 中文报错", false, "预期配置错误但没有报错"));
  } catch (error) {
    const ok = error instanceof ModelConfigError && /模型服务尚未配置/.test(error.message);
    results.push(report("4 中文报错", ok, describeError(error)));
  } finally {
    process.env.MODEL_API_KEY = originalApiKey;
  }

  for (const modelName of ["GLM-5.3", "DeepSeek-V4.1-Flash"]) {
    try {
      const started = Date.now();
      const content = await chatCompletion(
        [{ role: "user", content: "只回复两个字：可用" }],
        { model: modelName, timeoutMs: 30_000 },
      );
      results.push(
        report(
          `5 模型可用性 ${modelName}`,
          content.trim().length > 0,
          `${Date.now() - started}ms，返回长度 ${content.length}，摘要 ${content.slice(0, 20)}`,
        ),
      );
    } catch (error) {
      results.push(report(`5 模型可用性 ${modelName}`, false, describeError(error)));
    }
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`SUMMARY | 通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

await main();