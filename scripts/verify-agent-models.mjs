import { chatCompletion, resolveModelName } from "../src/lib/model-client.ts";

const roles = ["planner", "coach"];
const results = [];

console.log("MODEL_NAME_PLANNER 解析结果：", resolveModelName("planner"));
console.log("MODEL_NAME_COACH 解析结果：", resolveModelName("coach"));

for (const role of roles) {
  try {
    const started = Date.now();
    const content = await chatCompletion(
      [{ role: "user", content: "只回复两个字：可用" }],
      { role, timeoutMs: 90_000, maxRetries: 0 },
    );
    results.push({ role, ok: true });
    console.log(`PASS | ${role} | ${Date.now() - started}ms | 返回长度 ${content.length}`);
  } catch (error) {
    results.push({ role, ok: false });
    const message = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
    console.log(`FAIL | ${role} | ${message}`);
  }
}

const failed = results.filter((item) => !item.ok);
console.log(`SUMMARY | 通过 ${results.length - failed.length}/${results.length}`);
if (failed.length > 0) {
  process.exitCode = 2;
}