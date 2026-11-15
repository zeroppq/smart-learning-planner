const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

function brief(text, max = 60) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function printVerdict(tag, data) {
  console.log("VERDICT |", tag, "|", data.verdict, "|", brief(data.feedback, 120));
  console.log("GAPS |", tag, "|", JSON.stringify(data.gaps ?? []));
  console.log("SUGGESTIONS |", tag, "|", JSON.stringify(data.suggestions ?? []));
}

const planResponse = await fetch(`${BASE}/api/plans/current`);
const planData = await planResponse.json();
const route = planData.plan?.route ?? [];

if (route.length === 0) {
  console.error("没有可用计划，请先运行 scripts/verify-plan.mjs");
  process.exit(1);
}

const mainPoint = route[0];
const secondPoint = route[1] ?? route[0];

console.log("POINT | 主样例知识点 |", mainPoint.point_title);
console.log("POINT | 重判样例知识点 |", secondPoint.point_title);

console.log("\nSTEP 1 | 开始学习：讲解 + 判定标准");
const start = await post("/api/coach/start", { knowledgePointId: mainPoint.knowledge_point_id });
console.log("HTTP", start.status, "ok", start.data.ok);
console.log("STANDARD | 讲清楚条目数", start.data.standard?.explain?.length ?? 0);
console.log("STANDARD | 做对题条目数", start.data.standard?.practice?.length ?? 0);
console.log("STANDARD | 做出来条目数", start.data.standard?.apply?.length ?? 0);
console.log("LECTURE | 摘要", brief(start.data.lecture, 120));

const explainQuestion = start.data.next?.question ?? "";
const lectureAnswer = `${start.data.lecture ?? ""} 它是计算机基础里的核心概念，能帮助理解后续章节。`;

console.log("\nSTEP 2 | 第一层 讲清楚：先说含糊答案");
const weakExplain = await post("/api/coach/judge", {
  knowledgePointId: mainPoint.knowledge_point_id,
  layer: "explain",
  question: explainQuestion,
  answer: "大概就是那个意思吧，我也说不太清楚。",
});
console.log("INPUT | 大概就是那个意思吧，我也说不太清楚。");
printVerdict("含糊回答", weakExplain.data);

console.log("\nSTEP 3 | 第一层 讲清楚：再提交完整答案");
const goodExplain = await post("/api/coach/judge", {
  knowledgePointId: mainPoint.knowledge_point_id,
  layer: "explain",
  question: explainQuestion,
  answer: lectureAnswer,
});
console.log("INPUT |", brief(lectureAnswer, 80));
printVerdict("完整回答", goodExplain.data);

console.log("\nSTEP 4 | 第二层 做对题：先出题，再作答");
const practiceQuestion = await post("/api/coach/judge", {
  knowledgePointId: mainPoint.knowledge_point_id,
  layer: "practice",
  question: "",
  answer: "",
});
const practiceAnswer = `${practiceQuestion.data.question ?? ""} 的回答：${(
  practiceQuestion.data.expectedPoints ?? []
).join("；")}`;
const practiceJudge = await post("/api/coach/judge", {
  knowledgePointId: mainPoint.knowledge_point_id,
  layer: "practice",
  question: practiceQuestion.data.question,
  answer: practiceAnswer,
});
console.log("QUESTION |", brief(practiceQuestion.data.question, 100));
console.log("INPUT |", brief(practiceAnswer, 80));
printVerdict("练习作答", practiceJudge.data);

console.log("\nSTEP 5 | 第三层 做出来：先出任务，再提交方案");
const applyQuestion = await post("/api/coach/judge", {
  knowledgePointId: mainPoint.knowledge_point_id,
  layer: "apply",
  question: "",
  answer: "",
});
const applyAnswer = `我的做法：${(applyQuestion.data.expectedPoints ?? []).join("；")}。结果能对应资料里的说明。`;
const applyJudge = await post("/api/coach/judge", {
  knowledgePointId: mainPoint.knowledge_point_id,
  layer: "apply",
  question: applyQuestion.data.question,
  answer: applyAnswer,
});
console.log("QUESTION |", brief(applyQuestion.data.question, 100));
console.log("INPUT |", brief(applyAnswer, 80));
printVerdict("应用作答", applyJudge.data);
console.log("MASTERY |", applyJudge.data.mastery?.mastery_status ?? "unknown");

console.log("\nSTEP 6 | 重判样例：另一个知识点先失败，再补充说明重判");
const secondStart = await post("/api/coach/start", { knowledgePointId: secondPoint.knowledge_point_id });
const secondQuestion = secondStart.data.next?.question ?? "";
const failResult = await post("/api/coach/judge", {
  knowledgePointId: secondPoint.knowledge_point_id,
  layer: "explain",
  question: secondQuestion,
  answer: "不知道。",
});
printVerdict("重判前", failResult.data);

const rejudgeResult = await post("/api/coach/judge", {
  knowledgePointId: secondPoint.knowledge_point_id,
  layer: "explain",
  question: secondQuestion,
  answer: `${secondStart.data.lecture ?? ""} 我能说清它是什么、解决什么问题。`,
  rejudge: true,
  rejudgeNote: "刚才紧张没答上来，补充说明后重新回答。",
});
printVerdict("重判", rejudgeResult.data);

const repeatRejudge = await post("/api/coach/judge", {
  knowledgePointId: secondPoint.knowledge_point_id,
  layer: "explain",
  question: secondQuestion,
  answer: "再次补充说明。",
  rejudge: true,
  rejudgeNote: "再试一次。",
});
console.log("REPEAT |", repeatRejudge.status, "|", brief(repeatRejudge.data.error, 80));

console.log("\nSTEP 7 | 手动抽查");
const reviewResponse = await fetch(`${BASE}/api/coach/review?manual=1`);
const reviewData = await reviewResponse.json();
console.log("HTTP", reviewResponse.status, "items", reviewData.items?.length ?? 0);
console.log("ITEM |", brief(reviewData.items?.[0]?.pointTitle, 40), "|", brief(reviewData.items?.[0]?.question, 100));

console.log("\nSTEP 8 | 知识库答疑");
const ask = await post("/api/coach/ask", {
  question: "为什么计算机要使用二进制？",
  knowledgePointId: mainPoint.knowledge_point_id,
});
console.log("HTTP", ask.status, "ok", ask.data.ok, "有依据", ask.data.hasEvidence);
console.log("ANSWER |", brief(ask.data.answer, 160));
console.log(
  "SOURCES |",
  (ask.data.sources ?? [])
    .slice(0, 3)
    .map((source) => `${source.materialName} 第${source.paragraphIndex}段`)
    .join(" / "),
);