import { spawnSync } from "node:child_process";

const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const steps = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, data: await response.json() };
}

async function step(name, action) {
  const started = Date.now();
  const result = await action();
  const ms = Date.now() - started;
  steps.push({ name, ms, result });
  console.log(`STEP | ${name} | ${ms}ms | ${result}`);
  return result;
}

function reset(mode) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/reset-demo.mjs", mode],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`重置失败（${mode}）`);
  }
}

console.log("准备：重置为全新开始状态");
reset("fresh");

await sleep(500);

await step("1 上传讲义（演示上传环节）", async () => {
  const text = `# 演示补充资料

## 0.1 计算机与信息

信息是需要被处理的数据，计算机把输入转换成有用的输出，这个过程称为信息处理。

## 0.2 小结

本节用于演示资料上传与知识点切分，内容较短，不影响主线计划。`;
  const body = new FormData();
  body.append("file", new File([text], "演示补充资料.md", { type: "text/markdown" }));
  const response = await fetch(`${BASE}/api/materials`, { method: "POST", body });
  const data = await response.json();
  return data.ok ? `切出 ${data.knowledgePointCount} 个知识点` : `失败：${data.error}`;
});

let goalId = "";
await step("2 创建目标并获取澄清问题", async () => {
  const data = await post("/api/goals", {
    goalText: "我想在三周内学懂大学计算机基础，为期末考试做准备",
    dailyMinutes: 40,
  });
  if (!data.data.ok) {
    throw new Error(data.data.error);
  }
  goalId = data.data.goal.learning_goal_id;
  return `澄清问题 ${data.data.questions?.length ?? 0} 个`;
});

const plan = await step("3 生成路线图与每日任务", async () => {
  const data = await post("/api/plans", { goalId, answers: [] });
  if (!data.data.ok) {
    throw new Error(data.data.error);
  }
  return `节点 ${data.data.plan.route.length}，任务 ${data.data.plan.daily_tasks.length}`;
});

const firstPoint = await fetch(`${BASE}/api/plans/current`)
  .then((response) => response.json())
  .then((data) => data.plan.route[0]);

await step("4 学一个知识点（讲解 + 标准 + 讲清楚判定）", async () => {
  const start = await post("/api/coach/start", { knowledgePointId: firstPoint.knowledge_point_id });
  if (!start.data.ok) {
    throw new Error(start.data.error);
  }
  const judge = await post("/api/coach/judge", {
    knowledgePointId: firstPoint.knowledge_point_id,
    layer: "explain",
    question: start.data.next.question,
    answer: `${start.data.lecture} 这一节说明了计算机基础里最核心的概念，也交代了它和后续章节的关系。`,
  });
  if (!judge.data.ok) {
    throw new Error(judge.data.error);
  }
  return `判定 ${judge.data.verdict}`;
});

await step("5 查看进度", async () => {
  const data = await fetch(`${BASE}/api/progress`).then((response) => response.json());
  return `总数 ${data.summary?.total ?? 0}，已通过 ${data.summary?.passed ?? 0}，待回炉 ${data.summary?.needsReview ?? 0}`;
});

await step("6 触发调整并确认（版本递增）", async () => {
  const created = await post("/api/plans/adjust");
  if (!created.data.ok || !created.data.proposal) {
    return `无需调整：${created.data.reason}`;
  }
  const confirmed = await post("/api/plans/adjustment/confirm", {
    proposalId: created.data.proposal.adjustment_proposal_id,
    action: "accept",
  });
  if (!confirmed.data.ok) {
    throw new Error(confirmed.data.error);
  }
  return `计划版本升到 v${confirmed.data.planVersion}`;
});

const total = steps.reduce((sum, item) => sum + item.ms, 0);
console.log(`\nTIMING | 系统总耗时 ${total}ms（${(total / 1000).toFixed(1)} 秒）`);
console.log(`TIMING | 3 分钟硬指标 | ${total <= 180000 ? "通过" : "超出"}`);

console.log("\n恢复：重置为演示主线状态");
reset("demo");
console.log("恢复完成：22 个知识点、2 个待回炉、计划 v1");