const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

function brief(text, max = 120) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

const planData = await (await fetch(`${BASE}/api/plans/current`)).json();
const point = planData.plan?.route?.[0];
if (!point) {
  console.error("没有可用计划");
  process.exit(1);
}

console.log("POINT |", point.point_title, "| 当前状态", point.point_status);

console.log("\nSTEP 1 | 第三层重新出题");
const questionResult = await post("/api/coach/judge", {
  knowledgePointId: point.knowledge_point_id,
  layer: "apply",
  question: "",
  answer: "",
});
console.log("QUESTION |", brief(questionResult.data.question, 160));

const fullAnswer = `四个阶段：电子管、晶体管、集成电路、大规模集成电路，顺序正确。
计算能力逐阶段提升，体积逐阶段缩小，功耗逐阶段下降。
按用途分为通用计算机与专用计算机；按规模分为巨型机、大型机、小型机、微型机和工作站。
个人电脑体积小但属于微型机，因为分类依据是规模而不是外形。
衡量性能的常见指标包括主频、字长、存储容量和运算速度。主频 3.6GHz 只说明时钟频率，不能单独判断整机性能，还要看字长、存储容量和实际应用场景。`;

console.log("\nSTEP 2 | 修改后重新提交应用答案");
const retry = await post("/api/coach/judge", {
  knowledgePointId: point.knowledge_point_id,
  layer: "apply",
  question: questionResult.data.question,
  answer: fullAnswer,
});
console.log("VERDICT |", retry.data.verdict, "|", brief(retry.data.feedback, 140));
console.log("GAPS |", (retry.data.gaps ?? []).length);
console.log("MASTERY |", retry.data.mastery?.mastery_status);

console.log("\nSTEP 3 | 交接检查：规划师读到最新掌握状态");
const after = await (await fetch(`${BASE}/api/plans/current`)).json();
const node = after.plan?.route?.find((item) => item.knowledge_point_id === point.knowledge_point_id);
console.log("PLAN_NODE_STATUS |", point.point_status, "->", node?.point_status);

console.log("\nSTEP 4 | 答疑边界：问一个资料外问题");
const outside = await post("/api/coach/ask", {
  question: "量子纠缠能不能用来实现超光速通信？",
  knowledgePointId: point.knowledge_point_id,
});
console.log("HAS_EVIDENCE |", outside.data.hasEvidence);
console.log("ANSWER |", brief(outside.data.answer, 140));