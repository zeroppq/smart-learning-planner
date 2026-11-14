import { spawnSync } from "node:child_process";

const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const rounds = 2;
const budgetMs = 180_000;
const fixedOverheadMs = 16_000; // 开场 8 秒 + 收尾 8 秒
const segmentBudgetsMs = [15_000, 18_000, 30_000, 40_000, 12_000, 30_000];

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

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, data: await response.json() };
}

async function timed(name, action) {
  const started = Date.now();
  const detail = await action();
  return { name, ms: Date.now() - started, detail };
}

async function runRound(round) {
  reset("fresh");
  await new Promise((resolve) => setTimeout(resolve, 500));

  const steps = [];

  steps.push(
    await timed("1 上传讲义", async () => {
      const text = `# 演示补充资料

## 0.1 信息与数据

信息是需要被处理的数据，计算机把输入转换成有用的输出。

## 0.2 本节小结

本节用于演示上传与知识点切分，不影响主线计划。`;
      const body = new FormData();
      body.append("file", new File([text], "演示补充资料.md", { type: "text/markdown" }));
      const response = await fetch(`${BASE}/api/materials`, { method: "POST", body });
      const data = await response.json();
      return `切出 ${data.knowledgePointCount ?? 0} 点`;
    }),
  );

  let goalId = "";
  steps.push(
    await timed("2 说目标 + 澄清", async () => {
      const data = await post("/api/goals", {
        goalText: "我想在三周内学懂大学计算机基础，为期末考试做准备",
        dailyMinutes: 40,
      });
      goalId = data.data.goal.learning_goal_id;
      return `澄清 ${data.data.questions?.length ?? 0} 问`;
    }),
  );

  steps.push(
    await timed("3 出计划", async () => {
      const data = await post("/api/plans", { goalId, answers: [] });
      const plan = data.data.plan;
      return `节点 ${plan.route.length}，任务 ${plan.daily_tasks.length}`;
    }),
  );

  steps.push(
    await timed("4 学一个点（讲解 + 标准 + 判定不过）", async () => {
      const current = await fetch(`${BASE}/api/plans/current`).then((response) => response.json());
      const point = current.plan.route[0];
      const start = await post("/api/coach/start", {
        knowledgePointId: point.knowledge_point_id,
      });
      const judge = await post("/api/coach/judge", {
        knowledgePointId: point.knowledge_point_id,
        layer: "explain",
        question: start.data.next.question,
        answer: "大概就是那个意思吧，我也说不太清楚。",
      });
      return `讲解 ${start.data.lecture?.length ?? 0} 字，判定 ${judge.data.verdict}`;
    }),
  );

  steps.push(
    await timed("5 看进度", async () => {
      const data = await fetch(`${BASE}/api/progress`).then((response) => response.json());
      return `待回炉 ${data.summary?.needsReview ?? 0}`;
    }),
  );

  steps.push(
    await timed("6 调整 + 确认", async () => {
      const created = await post("/api/plans/adjust");
      if (!created.data.ok) {
        return "无需调整";
      }
      const confirmed = await post("/api/plans/adjustment/confirm", {
        proposalId: created.data.proposal.adjustment_proposal_id,
        action: "accept",
      });
      return `版本 v${confirmed.data.planVersion}`;
    }),
  );

  const withBudget = steps.map((item, index) => ({
    ...item,
    budgetMs: segmentBudgetsMs[index] ?? 0,
    overBudget: item.ms > (segmentBudgetsMs[index] ?? Infinity),
  }));

  const plannedTotalMs =
    fixedOverheadMs +
    withBudget.reduce((sum, item) => sum + Math.max(item.ms, item.budgetMs), 0);
  const systemMs = steps.reduce((sum, item) => sum + item.ms, 0);

  console.log(`\n=== 第 ${round} 遍 ===`);
  withBudget.forEach((item) => {
    console.log(
      `  ${item.name} | 系统 ${item.ms}ms | 段预算 ${item.budgetMs}ms | ${item.overBudget ? "超出段预算" : "在预算内"} | ${item.detail}`,
    );
  });
  console.log(`  系统耗时合计 | ${systemMs}ms（${(systemMs / 1000).toFixed(1)} 秒）`);
  console.log(
    `  按脚本预算总时长 | ${(plannedTotalMs / 1000).toFixed(1)} 秒 | ${plannedTotalMs <= budgetMs ? "达标" : "超出"}`,
  );

  return { systemMs, plannedTotalMs };
}

const results = [];
for (let round = 1; round <= rounds; round += 1) {
  results.push(await runRound(round));
}

reset("demo");

console.log("\n=== 汇总 ===");
results.forEach((item, index) => {
  console.log(
    `第 ${index + 1} 遍：系统 ${(item.systemMs / 1000).toFixed(1)} 秒，按脚本预算总时长 ${(
      item.plannedTotalMs / 1000
    ).toFixed(1)} 秒`,
  );
});
const allPass = results.every((item) => item.plannedTotalMs <= budgetMs);
console.log(`180 秒硬指标 | ${allPass ? "两遍均达标" : "存在超标"}`);
console.log("演示数据已恢复为 demo 模式");