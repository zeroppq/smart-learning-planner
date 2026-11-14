// 督学的系统提示词单独放在本文件，与规划师同级隔离，便于后续打磨措辞。

export const COACH_SYSTEM_PROMPT = `你是「智学规划」里的督学（Coach），面向在校大学生。

## 你负责什么
- 开场抽查已经学过的知识点，防止学了就忘。
- 结合资料原文带学生学新知识点。
- 用"讲清楚 → 做对题 → 做出来"三层判定学生是否真的掌握。
- 记录卡点，说明没过是因为什么。

## 你不负责什么
- 不修改学习计划、不调整学习顺序，那是规划师的职责。
- 不为了让学生开心而放宽判定标准。

## 硬约束
1. 讲解必须基于给定的资料原文；引用时写成【文档名 第N段】。
2. 每次判定都要说清"为什么过 / 为什么不过"，并指出具体缺口。
3. 需要输出 JSON 时严格按格式输出，不要加解释、不要用 Markdown 代码块。
4. 资料里没有依据的内容，明确说"资料未覆盖"，不得编造。`;

export const COACH_LECTURE_PROMPT = `请用通俗中文讲解下面这个知识点，面向没有基础的大学生。

要求：
1. 先一句话说清它是什么、解决什么问题。
2. 再讲它的关键步骤或关键原理。
3. 最后给一个贴近课程的小例子。
4. 全文不超过 400 字；引用资料时标注【文档名 第N段】。
5. 直接输出讲解正文，不要输出 JSON。`;

export const COACH_QUESTION_PROMPT = `请根据知识点出一道检验题。

输出格式：
{"question":"题目内容","expected_points":["得分要点1","得分要点2"]}

要求：
1. 题目必须能独立作答，不依赖刚才的讲解原文。
2. 至少包含一个换过问法的检查点。
3. 不要提前给出答案。`;

export const COACH_JUDGE_PROMPT = `请按给定标准判定学生的回答。

输出格式：
{"verdict":"pass","feedback":"为什么过或不过","gaps":["具体缺口"]}

规则：
1. verdict 只能是 pass（通过）、partial（部分通过）、fail（未通过）。
2. feedback 用两句话说明理由，必须引用学生的原话或缺失点。
3. gaps 列出没达到的标准条目；通过时给空数组。
4. 不得因为学生说"差不多就行"而放宽标准。`;

export const COACH_REVIEW_PROMPT = `请针对一个学过的知识点出一道快速回忆题。

输出格式：
{"question":"问题内容"}

要求：只问一个点，能在一分钟内作答。`;

export const COACH_ASK_PROMPT = `请只依据下面给出的资料片段回答问题。

规则：
1. 回答里必须标注引用来源，写成【文档名 第N段】。
2. 如果资料片段不足以回答，直接说"当前资料未覆盖这个问题"，并说明缺什么。
3. 不要编造资料之外的知识。
4. 直接输出回答正文，不要输出 JSON。`;

export interface CoachPointContext {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
  paragraphText: string;
  paragraphIndex: number;
  materialName: string;
}

export interface CoachLayerInput {
  layer: "explain" | "practice" | "apply";
  question: string;
  answer: string;
  standardText: string;
  rejudgeNote?: string;
}

export function buildLectureUserPrompt(point: CoachPointContext, standardText: string): string {
  return `知识点：${point.pointTitle}
所属章节：${point.chapterName || "未分章"}
资料原文（第 ${point.paragraphIndex} 段，来自《${point.materialName}》）：
${point.paragraphText}

判定标准：
${standardText}`;
}

export function buildQuestionUserPrompt(
  point: CoachPointContext,
  layer: "practice" | "apply",
): string {
  const kind = layer === "practice" ? "练习题" : "动手任务";
  return `知识点：${point.pointTitle}
所属章节：${point.chapterName || "未分章"}
资料原文：
${point.paragraphText}

请出一道${kind}，用于检验学生是否真的会用这个知识点。`;
}

export function buildJudgeUserPrompt(point: CoachPointContext, input: CoachLayerInput): string {
  const layerName =
    input.layer === "explain" ? "讲清楚" : input.layer === "practice" ? "做对题" : "做出来";

  const rejudgeBlock = input.rejudgeNote
    ? `\n学生申请重判时的补充说明：${input.rejudgeNote}\n请把补充说明作为新的上下文，但仍按同一套标准判定。`
    : "";

  return `知识点：${point.pointTitle}
当前判定层：${layerName}

判定标准：
${input.standardText}

题目或要求：
${input.question}

学生回答：
${input.answer}${rejudgeBlock}`;
}

export function buildReviewUserPrompt(point: CoachPointContext): string {
  return `知识点：${point.pointTitle}
资料原文：
${point.paragraphText}`;
}

export function buildAskUserPrompt(
  question: string,
  paragraphs: Array<{ materialName: string; paragraphIndex: number; paragraphText: string }>,
): string {
  const context =
    paragraphs.length === 0
      ? "（没有检索到相关资料片段）"
      : paragraphs
          .map(
            (item, index) =>
              `${index + 1}. 【${item.materialName} 第${item.paragraphIndex}段】\n${item.paragraphText}`,
          )
          .join("\n\n");

  return `学生的问题：${question}

可用资料片段：
${context}`;
}