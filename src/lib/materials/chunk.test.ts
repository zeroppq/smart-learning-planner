import { describe, expect, it } from "vitest";
import { chunkKnowledgePoints } from "./chunk";
import { splitParagraphs } from "./parse";

describe("知识点切分", () => {
  it("按二级标题切分 Markdown，并记录章节名", () => {
    const text = `# 第一章 计算机基础

引言段落。

## 1.1 计算机的发展

第一段内容。

第二段内容。

## 1.2 计算机的组成

第三段内容。`;
    const drafts = chunkKnowledgePoints(splitParagraphs(text));

    expect(drafts).toHaveLength(2);
    expect(drafts[0].pointTitle).toBe("1.1 计算机的发展");
    expect(drafts[0].chapterName).toBe("第一章 计算机基础");
    expect(drafts[0].paragraphText).toContain("第一段内容");
    expect(drafts[1].pointTitle).toBe("1.2 计算机的组成");
    expect(drafts[1].knowledgePointOrder).toBe(2);
  });

  it("Markdown 标题后的正文即使没有空行也能被切开", () => {
    const text = `# 第一章

## 1.1 数制
计算机使用二进制表示数据。

## 1.2 编码
ASCII 是常见字符编码。`;
    const drafts = chunkKnowledgePoints(splitParagraphs(text));

    expect(drafts.map((draft) => draft.pointTitle)).toEqual(["1.1 数制", "1.2 编码"]);
    expect(drafts[0].paragraphText).toContain("二进制");
  });

  it("三级结构里只有最深层标题成为知识点，章标题只作上下文", () => {
    const text = `# 大学计算机基础

## 第一章

导语段落，不算知识点。

### 1.1 第一节

第一节的内容足够多。

### 1.2 第二节

第二节的内容足够多。

## 第二章

### 2.1 第一节

内容也足够多。`;
    const drafts = chunkKnowledgePoints(splitParagraphs(text));

    expect(drafts).toHaveLength(3);
    expect(drafts[0].pointTitle).toBe("1.1 第一节");
    expect(drafts[0].chapterName).toBe("第一章");
    expect(drafts[2].chapterName).toBe("第二章");
  });

  it("附录是答案库，不切成知识点", () => {
    const text = `# 书名

## 第一章

### 1.1 第一节

正文内容足够多。

## 附录：练习题参考答案

**1.1 第一节**

参考答案内容。`;
    const drafts = chunkKnowledgePoints(splitParagraphs(text));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].pointTitle).toBe("1.1 第一节");
  });

  it("只有标题没有正文的叶子标题不生成知识点", () => {
    const text = `# 书名

## 第一章

### 1.1 空标题

### 1.2 有内容

这里才有内容。`;
    const drafts = chunkKnowledgePoints(splitParagraphs(text));

    expect(drafts).toHaveLength(1);
    expect(drafts[0].pointTitle).toBe("1.2 有内容");
  });

  it("纯文本按每 5 段聚合为一个知识点", () => {
    const paragraphs = Array.from({ length: 12 }, (_value, index) => `第 ${index + 1} 段内容`);
    const drafts = chunkKnowledgePoints(paragraphs);

    expect(drafts).toHaveLength(3);
    expect(drafts[0].paragraphIndex).toBe(1);
    expect(drafts[1].paragraphIndex).toBe(6);
    expect(drafts[2].paragraphIndex).toBe(11);
  });

  it("段落序号从 1 开始，能定位回原文", () => {
    const text = `# 课程

## 第一节
内容一。

## 第二节
内容二。`;
    const paragraphs = splitParagraphs(text);
    const drafts = chunkKnowledgePoints(paragraphs);

    const first = paragraphs[drafts[0].paragraphIndex - 1];
    expect(first).toContain("第一节");
  });
});