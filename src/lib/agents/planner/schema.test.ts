import { describe, expect, it } from "vitest";
import {
  PlanValidationError,
  buildDailyTasks,
  validateClarifyQuestions,
  validateRoute,
} from "./schema";

const ids = new Set(["kp-1", "kp-2", "kp-3"]);

describe("规划师路线校验", () => {
  it("接受合法路线并重新编号", () => {
    const route = validateRoute(
      {
        route: [
          { knowledge_point_id: "kp-1", prerequisite_point_id: null, stage: "foundation" },
          { knowledge_point_id: "kp-2", prerequisite_point_id: "kp-1", stage: "core" },
        ],
      },
      ids,
    );

    expect(route).toHaveLength(2);
    expect(route[1]).toMatchObject({ node_order: 2, prerequisite_point_id: "kp-1" });
  });

  it("拒绝知识库里不存在的知识点", () => {
    expect(() =>
      validateRoute({ route: [{ knowledge_point_id: "kp-不存在" }] }, ids),
    ).toThrow(PlanValidationError);
  });

  it("拒绝自己当前置", () => {
    expect(() =>
      validateRoute(
        { route: [{ knowledge_point_id: "kp-1", prerequisite_point_id: "kp-1" }] },
        ids,
      ),
    ).toThrow(PlanValidationError);
  });

  it("拒绝形成环的前置关系", () => {
    expect(() =>
      validateRoute(
        {
          route: [
            { knowledge_point_id: "kp-1", prerequisite_point_id: "kp-2" },
            { knowledge_point_id: "kp-2", prerequisite_point_id: "kp-1" },
          ],
        },
        ids,
      ),
    ).toThrow(/环/);
  });

  it("重复知识点只保留一次", () => {
    const route = validateRoute(
      {
        route: [
          { knowledge_point_id: "kp-1" },
          { knowledge_point_id: "kp-1" },
          { knowledge_point_id: "kp-2" },
        ],
      },
      ids,
    );

    expect(route.map((node) => node.knowledge_point_id)).toEqual(["kp-1", "kp-2"]);
  });

  it("非法 stage 回落到 core", () => {
    const route = validateRoute(
      { route: [{ knowledge_point_id: "kp-1", stage: "专家级" }] },
      ids,
    );

    expect(route[0].stage).toBe("core");
  });

  it("空路线直接判为不可用", () => {
    expect(() => validateRoute({ route: [] }, ids)).toThrow(PlanValidationError);
  });
});

describe("每日任务生成", () => {
  function routeOf(count: number) {
    return Array.from({ length: count }, (_value, index) => ({
      knowledge_point_id: `kp-${index + 1}`,
      prerequisite_point_id: index === 0 ? null : `kp-${index}`,
      node_order: index + 1,
      stage: "core" as const,
    }));
  }

  it("每天不超过 3 项，且落在 14 天周期内", () => {
    const tasks = buildDailyTasks({
      route: routeOf(30),
      startDate: "2026-11-15",
      dailyMinutes: 40,
    });

    const perDay = new Map<string, number>();
    tasks.forEach((task) => perDay.set(task.task_date, (perDay.get(task.task_date) ?? 0) + 1));

    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
    expect(tasks.every((task) => task.task_date >= "2026-11-15")).toBe(true);
    expect(tasks.every((task) => task.task_date <= "2026-11-28")).toBe(true);
  });

  it("每个任务预计用时加起来接近每日设定时长", () => {
    const tasks = buildDailyTasks({
      route: routeOf(30),
      startDate: "2026-11-15",
      dailyMinutes: 60,
    });

    const byDate = new Map<string, number>();
    tasks.forEach((task) => byDate.set(task.task_date, (byDate.get(task.task_date) ?? 0) + task.estimated_minutes));

    for (const total of byDate.values()) {
      expect(total).toBeGreaterThanOrEqual(45);
      expect(total).toBeLessThanOrEqual(75);
    }
  });

  it("知识点少于 14 个时，每天只排一个任务", () => {
    const tasks = buildDailyTasks({
      route: routeOf(12),
      startDate: "2026-11-15",
      dailyMinutes: 40,
    });

    const perDay = new Map<string, number>();
    tasks.forEach((task) => perDay.set(task.task_date, (perDay.get(task.task_date) ?? 0) + 1));

    expect(Math.max(...perDay.values())).toBe(1);
    expect(perDay.size).toBe(12);
  });
});

describe("澄清问题校验", () => {
  it("最多保留 3 个问题并过滤空值", () => {
    const questions = validateClarifyQuestions({
      questions: ["范围是什么？", "  ", "基础如何？", "多久完成？", "多余问题"],
    });

    expect(questions).toEqual(["范围是什么？", "基础如何？", "多久完成？"]);
  });

  it("格式不对时返回空数组", () => {
    expect(validateClarifyQuestions({ questions: "不是数组" })).toEqual([]);
    expect(validateClarifyQuestions(null)).toEqual([]);
  });
});