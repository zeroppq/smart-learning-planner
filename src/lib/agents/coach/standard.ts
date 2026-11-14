export interface JudgeStandard {
  explain: string[];
  practice: string[];
  apply: string[];
  summary: string[];
}

export function buildJudgeStandard(point: {
  pointTitle: string;
  chapterName: string;
}): JudgeStandard {
  const title = point.pointTitle;
  const chapter = point.chapterName || "本章";

  return {
    explain: [
      `能用自己的话说清「${title}」是什么、解决什么问题`,
      `能说明它与${chapter}其他概念的关系`,
      "被追问细节时不含糊，也不是照读原文",
    ],
    practice: [
      "能独立做对至少一道基础题",
      "换一种问法后仍能做对",
      "能说清每一步为什么这样做",
    ],
    apply: [
      `能把「${title}」用在一个具体的小任务里`,
      "步骤完整，关键环节没有跳过",
      "能解释自己的做法与结果",
    ],
    summary: ["三层全部通过才算学会", "任一层未通过，状态记为待回炉"],
  };
}

export function formatStandardForPrompt(standard: JudgeStandard): string {
  return `【讲清楚标准】
${standard.explain.map((item) => `- ${item}`).join("\n")}

【做对题标准】
${standard.practice.map((item) => `- ${item}`).join("\n")}

【做出来标准】
${standard.apply.map((item) => `- ${item}`).join("\n")}`;
}