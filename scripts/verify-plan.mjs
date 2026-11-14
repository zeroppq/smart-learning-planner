const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";

async function postJson(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data };
}

const goalText = "我想在三周内学懂大学计算机基础，为期末考试做准备";

console.log("STEP 1 | 创建学习目标并获取澄清问题");
const goalResult = await postJson("/api/goals", { goalText, dailyMinutes: 40 });
console.log("HTTP", goalResult.status);
console.log("ok", goalResult.data.ok, "questions", goalResult.data.questions ?? []);

const goalId = goalResult.data.goal?.learning_goal_id;
if (!goalResult.data.ok || !goalId) {
  console.error("目标创建失败：", goalResult.data.error);
  process.exit(1);
}

console.log("STEP 2 | 基于知识库真实知识点生成计划");
const started = Date.now();
const planResult = await postJson("/api/plans", { goalId, answers: [] });
console.log("HTTP", planResult.status, "耗时", `${Date.now() - started}ms`);

if (!planResult.data.ok || !planResult.data.plan) {
  console.error("计划生成失败：", planResult.data.error);
  process.exit(1);
}

const plan = planResult.data.plan;
console.log("SUMMARY | 路线节点", plan.route.length);
console.log("SUMMARY | 任务条数", plan.daily_tasks.length);
console.log("SUMMARY | 有任务的天数", new Set(plan.daily_tasks.map((task) => task.task_date)).size);
console.log("SUMMARY | 今日任务", plan.today_tasks.length);

console.log("ROUTE | 前 5 个节点");
plan.route.slice(0, 5).forEach((node) => {
  const prerequisite = node.prerequisite_point_id ? `前置=${node.prerequisite_point_id}` : "无前置";
  console.log(`  ${node.node_order}. ${node.point_title} [${node.stage}] ${prerequisite}`);
});

console.log("STEP 3 | 读取当前计划");
const currentResponse = await fetch(`${BASE}/api/plans/current`);
const current = await currentResponse.json();
console.log("HTTP", currentResponse.status, "plan_id 一致", current.plan?.plan_id === plan.plan_id);