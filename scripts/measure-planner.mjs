import { chatCompletion } from "../src/lib/model-client.ts";
import {
  PLANNER_SYSTEM_PROMPT,
  buildRouteUserPrompt,
} from "../src/lib/agents/planner/system-prompt.ts";
import { getDatabase } from "../src/lib/db.ts";

const db = getDatabase();
const rows = db
  .prepare(
    `SELECT knowledge_point_id, point_title, chapter_name
       FROM knowledge_point
      ORDER BY knowledge_point_order ASC
      LIMIT 13`,
  )
  .all();

const points = rows.map((row) => ({
  knowledgePointId: row.knowledge_point_id,
  pointTitle: row.point_title,
  chapterName: row.chapter_name,
}));

console.log("POINTS", points.length);

const started = Date.now();
const content = await chatCompletion(
  [
    { role: "system", content: PLANNER_SYSTEM_PROMPT },
    {
      role: "user",
      content: buildRouteUserPrompt({
        goalText: "我想在三周内学懂大学计算机基础，为期末考试做准备",
        dailyMinutes: 40,
        points,
      }),
    },
  ],
  { role: "planner", timeoutMs: 300_000, maxRetries: 0 },
);

console.log("ELAPSED_MS", Date.now() - started);
console.log("CONTENT_LENGTH", content.length);
console.log("CONTENT_HEAD", JSON.stringify(content.slice(0, 400)));