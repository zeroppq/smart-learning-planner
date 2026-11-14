export interface KnowledgePointDraft {
  pointTitle: string;
  chapterName: string;
  paragraphIndex: number;
  paragraphText: string;
  knowledgePointOrder: number;
}

const TEXT_GROUP_SIZE = 5;
const MAX_POINT_TEXT_LENGTH = 4000;
const MAX_TITLE_LENGTH = 60;

interface HeadingInfo {
  index: number;
  level: number;
  title: string;
}

function parseHeading(paragraph: string): { level: number; title: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(paragraph.trim());
  if (!match) {
    return null;
  }
  return { level: match[1].length, title: match[2].trim() };
}

function collectHeadings(paragraphs: string[]): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  paragraphs.forEach((paragraph, index) => {
    const heading = parseHeading(paragraph);
    if (heading) {
      headings.push({ index, level: heading.level, title: heading.title });
    }
  });
  return headings;
}

function isHeadingLine(paragraph: string): boolean {
  return parseHeading(paragraph) !== null;
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function isAppendixTitle(title: string): boolean {
  return title.includes("附录");
}

function findParentHeading(headings: HeadingInfo[], index: number): HeadingInfo | null {
  const current = headings[index];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (headings[cursor].level < current.level) {
      return headings[cursor];
    }
  }
  return null;
}

/**
 * 切分规则：只有"叶子标题"才成为知识点。
 * 一个标题如果下面还有更深的标题，它只作为章节上下文（chapterName），不单独成点。
 * "附录"可以是叶子标题，但属于答案库，不切成学习内容；原文仍完整保留在资料正文里。
 */
export function chunkKnowledgePoints(paragraphs: string[]): KnowledgePointDraft[] {
  const headings = collectHeadings(paragraphs);

  if (headings.length === 0) {
    return chunkPlainText(paragraphs);
  }

  const drafts: KnowledgePointDraft[] = [];

  headings.forEach((heading, index) => {
    const nextHeading = headings[index + 1];
    const isLeaf = !nextHeading || nextHeading.level <= heading.level;

    if (!isLeaf) {
      return;
    }

    const parent = findParentHeading(headings, index);
    if (isAppendixTitle(heading.title) || (parent && isAppendixTitle(parent.title))) {
      return;
    }

    const start = heading.index + 1;
    const end = nextHeading ? nextHeading.index : paragraphs.length;
    const body = paragraphs
      .slice(start, end)
      .filter((paragraph) => !isHeadingLine(paragraph))
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    if (body.length === 0) {
      return;
    }

    drafts.push({
      pointTitle: truncate(heading.title, MAX_TITLE_LENGTH) || `第 ${heading.index + 1} 段`,
      chapterName: truncate(parent?.title ?? "", MAX_TITLE_LENGTH),
      paragraphIndex: heading.index + 1,
      paragraphText: `${heading.title}\n${body.join("\n")}`.slice(0, MAX_POINT_TEXT_LENGTH),
      knowledgePointOrder: drafts.length + 1,
    });
  });

  return drafts;
}

function chunkPlainText(paragraphs: string[]): KnowledgePointDraft[] {
  const drafts: KnowledgePointDraft[] = [];

  for (let index = 0; index < paragraphs.length; index += TEXT_GROUP_SIZE) {
    const group = paragraphs.slice(index, index + TEXT_GROUP_SIZE);
    if (group.length === 0) {
      continue;
    }
    drafts.push({
      pointTitle: truncate(group[0], MAX_TITLE_LENGTH),
      chapterName: "",
      paragraphIndex: index + 1,
      paragraphText: group.join("\n").slice(0, MAX_POINT_TEXT_LENGTH),
      knowledgePointOrder: drafts.length + 1,
    });
  }

  return drafts;
}