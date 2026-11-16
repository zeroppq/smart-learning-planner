import { describe, expect, it } from "vitest";
import { splitCitations } from "./cited-text";

describe("引用角标解析", () => {
  it("把正文中的【文档名 第N段】拆成角标与连续正文", () => {
    const parts = splitCitations("二进制只用两个符号。【大学计算机基础 第3段】这就是它的核心。");

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ kind: "text", value: "二进制只用两个符号。" });
    expect(parts[1]).toMatchObject({
      kind: "citation",
      citationIndex: 1,
      materialName: "大学计算机基础",
      paragraphIndex: 3,
    });
    expect(parts[2]).toEqual({ kind: "text", value: "这就是它的核心。" });
  });

  it("兼容段号两侧带空格的写法", () => {
    const parts = splitCitations("参考资料【课堂讲义 第 12 段】。");

    expect(parts[1]).toMatchObject({
      kind: "citation",
      materialName: "课堂讲义",
      paragraphIndex: 12,
    });
  });

  it("多处引用按出现顺序递增编号", () => {
    const parts = splitCitations("第一处【讲义 第1段】第二处【讲义 第4段】");

    const citations = parts.filter((part) => part.kind === "citation");
    expect(citations.map((part) => (part.kind === "citation" ? part.citationIndex : 0))).toEqual([1, 2]);
  });

  it("没有引用时保留整段正文", () => {
    const parts = splitCitations("这段回答没有标注来源。");

    expect(parts).toEqual([{ kind: "text", value: "这段回答没有标注来源。" }]);
  });
});