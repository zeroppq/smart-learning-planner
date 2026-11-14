import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chunkKnowledgePoints } from "../src/lib/materials/chunk.ts";
import { parseMaterial } from "../src/lib/materials/parse.ts";

const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const mode = process.argv[2] === "demo" ? "demo" : "fresh";
const databaseFile = process.env.DATABASE_FILE ?? join(process.cwd(), "data", "learning-planner.db");
const lectureFile = join(process.cwd(), "docs", "大学计算机基础_课堂讲义.md");
const PRESET_ID = "preset-university-computer-fundamentals";
const PRESET_NAME = "大学计算机基础_课堂讲义.md";
const GOAL_TEXT = "我想在三周内学懂大学计算机基础，为期末考试做准备";

function log(step, detail) {
  console.log(`[reset] ${step} | ${detail}`);
}

async function callApi(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(`${path} 失败：${data.error ?? data.reason ?? response.status}`);
  }
  return data;
}

const db = new DatabaseSync(databaseFile);
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("PRAGMA foreign_keys = ON;");

log("清空业务数据", "删除学习记录、计划与知识点");
db.exec("BEGIN");
try {
  db.prepare("DELETE FROM study_session").run();
  db.prepare("DELETE FROM mastery_record").run();
  db.prepare("DELETE FROM adjustment_proposal").run();
  db.prepare("DELETE FROM daily_task").run();
  db.prepare("DELETE FROM plan").run();
  db.prepare("DELETE FROM learning_goal").run();
  db.prepare("DELETE FROM knowledge_point").run();
  db.prepare("DELETE FROM source_material").run();
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  db.close();
  throw error;
}

const lectureText = readFileSync(lectureFile, "utf8");
const parsed = await parseMaterial(PRESET_NAME, Buffer.from(lectureText, "utf8"));
const drafts = chunkKnowledgePoints(parsed.paragraphs);
const now = new Date().toISOString();

db.prepare(
  `INSERT INTO source_material
    (source_material_id, material_name, material_format, material_text, parse_status,
     paragraph_count, is_preset, created_at, updated_at)
   VALUES (?, ?, 'md', ?, 'success', ?, 1, ?, ?)`,
).run(PRESET_ID, PRESET_NAME, parsed.text, parsed.paragraphs.length, now, now);

const insertPoint = db.prepare(
  `INSERT INTO knowledge_point
    (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
     paragraph_text, knowledge_point_order, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const pointIds = drafts.map((draft) => {
  const id = randomUUID();
  insertPoint.run(
    id,
    PRESET_ID,
    draft.pointTitle,
    draft.chapterName,
    draft.paragraphIndex,
    draft.paragraphText,
    draft.knowledgePointOrder,
    now,
    now,
  );
  return id;
});

db.close();
log("导入正式讲义", `段落 ${parsed.paragraphs.length}，知识点 ${drafts.length}`);

log("创建学习目标", GOAL_TEXT);
const goalResult = await callApi("/api/goals", { goalText: GOAL_TEXT, dailyMinutes: 40 });
const goalId = goalResult.goal.learning_goal_id;

log("生成路线图与每日任务", "调用规划师，约数秒");
const planResult = await callApi("/api/plans", { goalId, answers: [] });
const route = planResult.plan.route;
log("计划完成", `节点 ${route.length}，任务 ${planResult.plan.daily_tasks.length}`);

if (mode === "demo") {
  const reviewIds = route.slice(0, 2).map((node) => node.knowledge_point_id);
  const db2 = new DatabaseSync(databaseFile);
  db2.exec("PRAGMA busy_timeout = 5000;");
  const insertMastery = db2.prepare(
    `INSERT INTO mastery_record
      (mastery_record_id, knowledge_point_id, mastery_status, explain_result, practice_result,
       apply_result, rejudge_used, weak_point_flag, review_count, last_studied_at, created_at, updated_at)
     VALUES (?, ?, 'needs_review', 'pass', 'fail', 'not_attempted', 0, 1, 0, ?, ?, ?)`,
  );
  const stamp = new Date().toISOString();
  for (const pointId of reviewIds) {
    insertMastery.run(randomUUID(), pointId, stamp, stamp, stamp);
  }
  db2.close();

  log("写入演示判定状态", `${reviewIds.length} 个知识点标记为待回炉`);

  const progress = await fetch(`${BASE}/api/progress`).then((response) => response.json());
  log(
    "进度汇总",
    `总数 ${progress.summary?.total ?? 0}，待回炉 ${progress.summary?.needsReview ?? 0}，计划版本 v${progress.summary?.planVersion ?? 1}`,
  );
}

console.log(`\n[reset] 完成，模式=${mode}`);
console.log("[reset] 下一步：浏览器打开 http://localhost:3000/ 或 /progress 开始演示");