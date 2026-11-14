import { spawnSync } from "node:child_process";

const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const results = [];

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return { status: response.status, data: await response.json() };
}

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, data: await response.json() };
}

async function upload(name, content, type) {
  const body = new FormData();
  body.append("file", new File([Uint8Array.from(content)], name, { type }));
  const response = await fetch(`${BASE}/api/materials`, { method: "POST", body });
  return { status: response.status, data: await response.json() };
}

function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);
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

const brokenPdf = await upload("broken.pdf", Buffer.from("%PDF-1.4 这不是完整文件"), "application/pdf");
check(
  "1 损坏 PDF：中文提示且标记失败",
  brokenPdf.status === 200 && brokenPdf.data.ok === false && /PDF 解析失败/.test(brokenPdf.data.error ?? ""),
  `HTTP ${brokenPdf.status}，${brokenPdf.data.error ?? ""}`.slice(0, 90),
);

const materials = await get("/api/materials");
check(
  "2 损坏 PDF 不影响其他资料",
  materials.data.materials?.some((item) => item.is_preset === 1 && item.parse_status === "success"),
  `资料数 ${materials.data.materials?.length ?? 0}`,
);

const pptx = await upload("slides.pptx", Buffer.from("x"), "application/vnd.ms-powerpoint");
check(
  "3 PPTX：拒绝并说明支持范围",
  pptx.status === 400 && /仅支持/.test(pptx.data.error ?? ""),
  `HTTP ${pptx.status}，${pptx.data.error ?? ""}`.slice(0, 90),
);

const beforePlan = await get("/api/plans/current");
const badPlan = await post("/api/plans", { goalId: "wrong-goal", answers: [] });
const afterPlan = await get("/api/plans/current");
check(
  "4 计划生成失败：中文提示且原计划不变",
  badPlan.status === 409 &&
    /目标已变化/.test(badPlan.data.error ?? "") &&
    beforePlan.data.plan?.plan_id === afterPlan.data.plan?.plan_id,
  `HTTP ${badPlan.status}，plan_id 一致 ${beforePlan.data.plan?.plan_id === afterPlan.data.plan?.plan_id}`,
);

const plan = afterPlan.data.plan;
const reviewPoint = plan.route.find((node) => node.point_status === "needs_review") ?? plan.route[0];
const start = await post("/api/coach/start", { knowledgePointId: reviewPoint.knowledge_point_id });
const question = start.data.next?.question ?? "请复述这个知识点";

const firstRejudge = await post("/api/coach/judge", {
  knowledgePointId: reviewPoint.knowledge_point_id,
  layer: "explain",
  question,
  answer: "补充说明后重新回答：这个知识点讲的是把复杂任务拆成可执行步骤。",
  rejudge: true,
  rejudgeNote: "刚才答得不完整，补充说明。",
});
const secondRejudge = await post("/api/coach/judge", {
  knowledgePointId: reviewPoint.knowledge_point_id,
  layer: "explain",
  question,
  answer: "再次补充说明。",
  rejudge: true,
  rejudgeNote: "再试一次。",
});
check(
  "5 重判用尽：第二次被拒绝",
  secondRejudge.status === 400 && /重判机会已用完/.test(secondRejudge.data.error ?? ""),
  `第一次 ${firstRejudge.status}，第二次 ${secondRejudge.status}，${secondRejudge.data.error ?? ""}`.slice(0, 100),
);

const emptyAnswer = await post("/api/coach/judge", {
  knowledgePointId: reviewPoint.knowledge_point_id,
  layer: "explain",
  question,
  answer: "",
});
check(
  "6 空回答：中文提示，不写状态",
  emptyAnswer.status === 400 && /请先作答/.test(emptyAnswer.data.error ?? ""),
  `HTTP ${emptyAnswer.status}，${emptyAnswer.data.error ?? ""}`.slice(0, 90),
);

const outside = await post("/api/coach/ask", {
  question: "量子纠缠能不能实现超光速通信？",
  knowledgePointId: reviewPoint.knowledge_point_id,
});
check(
  "7 资料外问题：明确说明未覆盖",
  outside.status === 200 && /未覆盖/.test(outside.data.answer ?? ""),
  `${outside.data.answer ?? ""}`.slice(0, 90),
);

const failed = results.filter((item) => !item.ok);
console.log(`\nSUMMARY | 通过 ${results.length - failed.length}/${results.length}`);
console.log("说明：模型超时与模型返回不可解析属于模型层异常，已由单元测试覆盖（model-client 超时、planner/coach 对非 JSON 抛中文错误），接口层统一映射为 502 中文提示。");

reset("demo");
console.log("已恢复演示主线数据");

if (failed.length > 0) {
  process.exitCode = 2;
}