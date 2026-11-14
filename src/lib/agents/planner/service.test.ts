import { describe, expect, it } from "vitest";
import { ModelJsonError } from "@/lib/agents/json";
import { PlanValidationError } from "./schema";
import { generateClarifyingQuestions, generatePlanDraft } from "./service";

const points = [
  { knowledgePointId: "kp-1", pointTitle: "计算机的发展", chapterName: "第一章" },
  { knowledgePointId: "kp-2", pointTitle: "计算机系统的组成", chapterName: "第一章" },
];

describe("规划师服务", () => {
  it("正常生成路线与每日任务", async () => {
    const caller = async () =>
      JSON.stringify({
        route: [
          { knowledge_point_id: "kp-1", prerequisite_point_id: null, stage: "foundation" },
          { knowledge_point_id: "kp-2", prerequisite_point_id: "kp-1", stage: "core" },
        ],
      });

    const draft = await generatePlanDraft(
      { goalText: "学懂计算机基础", dailyMinutes: 40, points, startDate: "2026-11-15" },
      caller,
    );

    expect(draft.route).toHaveLength(2);
    expect(draft.daily_tasks).toHaveLength(2);
    expect(draft.daily_tasks[0].task_date).toBe("2026-11-15");
  });

  it("模型返回非 JSON 时抛错，不产生计划", async () => {
    const caller = async () => "我今天不想输出 JSON";

    await expect(
      generatePlanDraft({ goalText: "学懂计算机基础", dailyMinutes: 40, points }, caller),
    ).rejects.toBeInstanceOf(ModelJsonError);
  });

  it("模型编造知识点时拒绝落库", async () => {
    const caller = async () =>
      JSON.stringify({ route: [{ knowledge_point_id: "kp-编造", prerequisite_point_id: null }] });

    await expect(
      generatePlanDraft({ goalText: "学懂计算机基础", dailyMinutes: 40, points }, caller),
    ).rejects.toBeInstanceOf(PlanValidationError);
  });

  it("澄清问题生成失败时返回空列表，不阻塞主流程", async () => {
    const caller = async () => {
      throw new Error("模型超时");
    };

    const questions = await generateClarifyingQuestions(
      { goalText: "学懂计算机基础", dailyMinutes: 40, pointCount: 2 },
      caller,
    );

    expect(questions).toEqual([]);
  });

  it("澄清问题最多 3 个", async () => {
    const caller = async () =>
      JSON.stringify({ questions: ["范围？", "基础？", "时间？", "多余？"] });

    const questions = await generateClarifyingQuestions(
      { goalText: "学懂计算机基础", dailyMinutes: 40, pointCount: 2 },
      caller,
    );

    expect(questions).toHaveLength(3);
  });
});