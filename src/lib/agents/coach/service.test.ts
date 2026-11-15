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
    const verdict = validateVerdict({ verdict: "pass", feedback: "讲清楚了", gaps: [] }, 3);
    expect(verdict.verdict).toBe("pass");
    expect(verdict.gaps).toEqual([]);
    expect(verdict.suggestions).toEqual([]);
  });

  it("非法的判定结论会被拒绝", () => {
    expect(() => validateVerdict({ verdict: "大概算过吧" }, 3)).toThrow();
  });

  it("编号越界的缺口降级为建议，合法缺口保留", () => {
    const verdict = validateVerdict(
      {
        verdict: "partial",
        feedback: "缺一个例子",
        gaps: [
          { standard_index: 5, detail: "越界的缺口" },
          { standard_index: 2, detail: "没有举例" },
        ],
      },
      3,
    );
    expect(verdict.gaps).toEqual([{ standard_index: 2, detail: "没有举例" }]);
    expect(verdict.suggestions).toEqual(["越界的缺口"]);
  });

  it("判不过但没有合法缺口时被拒绝", () => {
    expect(() =>
      validateVerdict(
        { verdict: "fail", feedback: "没过", gaps: [{ standard_index: 9, detail: "越界" }] },
        3,
      ),
    ).toThrow();
  });

  it("旧格式的字符串缺口降级为建议", () => {
    const verdict = validateVerdict(
      { verdict: "pass", feedback: "讲清楚了", gaps: ["旧格式的缺口"] },
      3,
    );
    expect(verdict.gaps).toEqual([]);
    expect(verdict.suggestions).toEqual(["旧格式的缺口"]);
  });

  it("通过时给出的缺口会被清空", () => {
    const verdict = validateVerdict(
      { verdict: "pass", feedback: "讲清楚了", gaps: [{ standard_index: 1, detail: "多余的缺口" }] },
      3,
    );
    expect(verdict.gaps).toEqual([]);
  });

  it("题目太短视为无效", () => {
    expect(() => validateQuestion({ question: "嗯" })).toThrow();
  });
});

describe("督学模型调用", () => {
  it("判定结果经模型返回后被正确解析", async () => {
    const caller = async () =>
      JSON.stringify({
        verdict: "partial",
        feedback: "少了一个例子",
        gaps: [{ standard_index: 2, detail: "没有举例" }],
        suggestions: ["可以联系本章其他概念"],
      });

    const verdict = await judgeAnswer(
      point,
      {
        layer: "explain",
        question: "请复述",
        answer: "二进制就是 0 和 1",
        standardItems: ["标准一", "标准二", "标准三"],
      },
      caller,
    );

    expect(verdict.verdict).toBe("partial");
    expect(verdict.gaps).toEqual([{ standard_index: 2, detail: "没有举例" }]);
    expect(verdict.suggestions).toEqual(["可以联系本章其他概念"]);
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