import { describe, expect, it } from "vitest";
import {
  answerWithKnowledge,
  generateReviewQuestion,
  judgeAnswer,
  validateQuestion,
  validateVerdict,
} from "./service";

const point = {
  knowledgePointId: "kp-1",
  pointTitle: "数制与编码",
  chapterName: "第一章",
  paragraphText: "计算机使用二进制表示数据。",
  paragraphIndex: 1,
  materialName: "测试讲义.md",
};

describe("督学判定解析", () => {
  it("接受明确的通过结论", () => {
    const verdict = validateVerdict({ verdict: "pass", feedback: "讲清楚了", gaps: [] });
    expect(verdict.verdict).toBe("pass");
  });

  it("非法的判定结论会被拒绝", () => {
    expect(() => validateVerdict({ verdict: "大概算过吧" })).toThrow();
  });

  it("缺口列表最多保留 5 条", () => {
    const verdict = validateVerdict({
      verdict: "fail",
      feedback: "缺关键步骤",
      gaps: ["1", "2", "3", "4", "5", "6"],
    });
    expect(verdict.gaps).toHaveLength(5);
  });

  it("题目太短视为无效", () => {
    expect(() => validateQuestion({ question: "嗯" })).toThrow();
  });
});

describe("督学模型调用", () => {
  it("判定结果经模型返回后被正确解析", async () => {
    const caller = async () =>
      JSON.stringify({ verdict: "partial", feedback: "少了一个例子", gaps: ["没有举例"] });

    const verdict = await judgeAnswer(
      point,
      { layer: "explain", question: "请复述", answer: "二进制就是 0 和 1", standardText: "标准" },
      caller,
    );

    expect(verdict.verdict).toBe("partial");
    expect(verdict.gaps).toEqual(["没有举例"]);
  });

  it("抽查题生成失败时退回固定问法", async () => {
    const caller = async () => {
      throw new Error("超时");
    };

    const question = await generateReviewQuestion(point, caller);

    expect(question).toContain("复述");
    expect(question).toContain("数制与编码");
  });

  it("资料里没有内容时不调用模型，直接说明未覆盖", async () => {
    let called = 0;
    const caller = async () => {
      called += 1;
      return "编造的答案";
    };

    const answer = await answerWithKnowledge("什么是量子纠缠", [], caller);

    expect(called).toBe(0);
    expect(answer).toContain("资料未覆盖");
  });
});