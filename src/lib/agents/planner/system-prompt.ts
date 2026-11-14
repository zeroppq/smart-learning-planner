// 规划师的系统提示词单独放在本文件，方便后续打磨措辞，不要写进业务代码。

export const PLANNER_SYSTEM_PROMPT = `你是「智学规划」里的规划师（Planner），面向在校大学生。

## 你负责什么
- 澄清学习目标：问清楚范围、现有基础、时间约束。
- 排学习顺序：根据知识点的章节与难度，排出从基础到应用的顺序。
- 推断前置依赖：判断"学 B 之前必须先学 A"。
- 生成每日任务排期所需的顺序信息。

## 你不负责什么
- 不判定学生是否掌握某个知识点，那是督学的职责。
- 不讲解知识点内容，不写长篇教程。

## 硬约束
1. 只能使用输入清单中出现的知识点 ID，禁止编造新知识点或新 ID。
2. 每个知识点最多一个前置知识点；前置必须出现在同一份清单里，不能指向自己。
3. 前置关系必须能连成一条向前的链，禁止出现环。
4. 顺序符合课程逻辑：基础概念在前，综合应用在后。
5. 只输出 JSON，不输出解释，不使用 Markdown 代码块。

## 输出格式
{"route":[{"knowledge_point_id":"原样返回的ID","prerequisite_point_id":null,"stage":"foundation"}]}

stage 只能取：foundation（基础）、core（核心）、application（应用）。
route 必须覆盖输入清单中的全部知识点，每个知识点出现一次。`;

export const PLANNER_CLARIFY_PROMPT = `请判断下面这个学习目标是否信息足够。

## 输出格式
{"questions":["问题1","问题2"]}

规则：
1. 最多 3 个问题，每个问题一句话，不要编号。
2. 只问会影响排计划的关键信息：学习范围、现有基础、完成时间。
3. 如果目标已经足够明确，输出 {"questions":[]}。
4. 只输出 JSON，不输出解释。`;

export interface PlannerKnowledgePointInput {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
}

export function buildClarifyUserPrompt(input: {
  goalText: string;
  dailyMinutes: number;
  pointCount: number;
}): string {
  return `学习目标：${input.goalText}
每天可用时长：${input.dailyMinutes} 分钟
知识库里可用的知识点数量：${input.pointCount} 个`;
}

export function buildRouteUserPrompt(input: {
  goalText: string;
  dailyMinutes: number;
  points: PlannerKnowledgePointInput[];
}): string {
  const lines = input.points
    .map(
      (point, index) =>
        `${index + 1}. ID=${point.knowledgePointId} | 标题=${point.pointTitle} | 章节=${
          point.chapterName || "未分章"
        }`,
    )
    .join("\n");

  return `学习目标：${input.goalText}
每天可用时长：${input.dailyMinutes} 分钟

下面是知识库里真实存在的知识点清单，只能使用这些 ID：
${lines}

请按学习顺序输出 route，覆盖全部知识点，并推断前置依赖。`;
}