import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  consumeRejudge,
  getMastery,
  getPointContext,
  recordLayerResult,
} from "./repository";
import { judgeAnswer, validateVerdict } from "./service";

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "smart-learning-flow-"));
  process.env.DATABASE_FILE = join(workDir, "test.db");
  closeDatabase();

  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO source_material
      (source_material_id, material_name, material_format, material_text, parse_status,
       paragraph_count, is_preset, created_at, updated_at)
     VALUES ('mat-1', '讲义.md', 'md', '计算机使用二进制表示数据。', 'success', 1, 1, ?, ?)`,
  ).run(now, now);
  db.prepare(
    `INSERT INTO knowledge_point
      (knowledge_point_id, source_material_id, point_title, chapter_name, paragraph_index,
       paragraph_text, knowledge_point_order, created_at, updated_at)
     VALUES ('kp-1', 'mat-1', '数制与编码', '第一章', 1, '计算机使用二进制表示数据。', 1, ?, ?)`,
  ).run(now, now);
});

afterEach(() => {
  closeDatabase();
  delete process.env.DATABASE_FILE;
  rmSync(workDir, { recursive: true, force: true });
});

function makeJudgeCaller(verdict: "pass" | "fail") {
  return async () =>
    JSON.stringify({
      verdict,
      feedback: verdict === "pass" ? "回答完整" : "缺少关键步骤",
      gaps: verdict === "pass" ? [] : [{ standard_index: 1, detail: "没有说明为什么" }],
      suggestions: [],
    });
}

describe("三层判定流程", () => {
  it("通过路径：三层全过，状态变为已通过", async () => {
    const point = getPointContext("kp-1");
    expect(point).toBeTruthy();

    for (const layer of ["explain", "practice", "apply"] as const) {
      const verdict = await judgeAnswer(
        point!,
        { layer, question: "题目", answer: "完整回答", standardItems: ["标准一", "标准二", "标准三"] },
        makeJudgeCaller("pass"),
      );
      expect(verdict.verdict).toBe("pass");
      recordLayerResult({ knowledgePointId: "kp-1", layer, result: verdict.verdict });
    }

    expect(getMastery("kp-1")?.mastery_status).toBe("passed");
  });

  it("未通过路径：练习层失败，状态变为待回炉", async () => {
    recordLayerResult({ knowledgePointId: "kp-1", layer: "explain", result: "pass" });

    const point = getPointContext("kp-1");
    const verdict = await judgeAnswer(
      point!,
      { layer: "practice", question: "题目", answer: "不完整", standardItems: ["标准一", "标准二", "标准三"] },
      makeJudgeCaller("fail"),
    );
    recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: verdict.verdict });

    expect(getMastery("kp-1")?.mastery_status).toBe("needs_review");
    expect(getMastery("kp-1")?.weak_point_flag).toBe(1);
  });

  it("重判路径：补充说明后结论可以变化", async () => {
    const point = getPointContext("kp-1");
    recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: "fail" });

    expect(consumeRejudge("kp-1")).toBe(true);

    const verdict = await judgeAnswer(
      point!,
      {
        layer: "practice",
        question: "题目",
        answer: "补充后的回答",
        standardItems: ["标准一", "标准二", "标准三"],
        rejudgeNote: "刚才漏写了关键步骤",
      },
      makeJudgeCaller("pass"),
    );

    recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: verdict.verdict });

    expect(getMastery("kp-1")?.practice_result).toBe("pass");
    expect(getMastery("kp-1")?.rejudge_used).toBe(1);
  });

  it("重复重判路径：第二次申请被拒绝", () => {
    recordLayerResult({ knowledgePointId: "kp-1", layer: "practice", result: "fail" });

    expect(consumeRejudge("kp-1")).toBe(true);
    expect(consumeRejudge("kp-1")).toBe(false);
  });
});

describe("判定结果解析", () => {
  it("模型给出不存在的结论时被拒绝，不会写入状态", () => {
    expect(() => validateVerdict({ verdict: "不错" }, 3)).toThrow();
  });
});