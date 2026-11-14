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

function headingLevel(paragraph: string): number {
  const match = /^(#{1,6})\s+/.exec(paragraph);
  return match ? match[1].length : 0;
}

function headingTitle(paragraph: string): string {
  return paragraph.replace(/^#{1,6}\s+/, "").trim();
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

export function chunkKnowledgePoints(paragraphs: string[]): KnowledgePointDraft[] {
  const hasAnyHeading = paragraphs.some((paragraph) => headingLevel(paragraph) > 0);

  if (!hasAnyHeading) {
    return chunkPlainText(paragraphs);
  }

  const chapterHasSubHeading = collectChapterInfo(paragraphs);
  const drafts: KnowledgePointDraft[] = [];
  let chapterName = "";
  let current: KnowledgePointDraft | null = null;

  function pushCurrent() {
    if (current) {
      current.paragraphText = current.paragraphText.slice(0, MAX_POINT_TEXT_LENGTH);
      drafts.push(current);
      current = null;
    }
  }

  paragraphs.forEach((paragraph, index) => {
    const level = headingLevel(paragraph);

    if (level === 1) {
      pushCurrent();
      chapterName = headingTitle(paragraph);
      if (!chapterHasSubHeading.get(chapterName)) {
        current = createDraft(chapterName, chapterName, index, paragraph);
      }
      return;
    }

    if (level >= 2) {
      pushCurrent();
      current = createDraft(headingTitle(paragraph), chapterName, index, paragraph);
      return;
    }

    if (current) {
      current.paragraphText = `${current.paragraphText}\n${paragraph}`;
      return;
    }

    if (chapterHasSubHeading.get(chapterName)) {
      // 章节标题与第一个小节标题之间的导语不计为知识点
      return;
    }

    current = createDraft(
      chapterName || truncate(paragraph, MAX_TITLE_LENGTH),
      chapterName,
      index,
      paragraph,
    );
  });

  pushCurrent();

  return drafts.map((draft, order) => ({
    ...draft,
    knowledgePointOrder: order + 1,
  }));
}

function collectChapterInfo(paragraphs: string[]): Map<string, boolean> {
  const chapterHasSubHeading = new Map<string, boolean>();
  let currentChapter = "";

  for (const paragraph of paragraphs) {
    const level = headingLevel(paragraph);
    if (level === 1) {
      currentChapter = headingTitle(paragraph);
      if (!chapterHasSubHeading.has(currentChapter)) {
        chapterHasSubHeading.set(currentChapter, false);
      }
      continue;
    }
    if (level >= 2 && currentChapter) {
      chapterHasSubHeading.set(currentChapter, true);
    }
  }

  return chapterHasSubHeading;
}

function createDraft(
  title: string,
  chapterName: string,
  paragraphIndex: number,
  paragraphText: string,
): KnowledgePointDraft {
  return {
    pointTitle: truncate(title, MAX_TITLE_LENGTH) || `第 ${paragraphIndex + 1} 段`,
    chapterName: truncate(chapterName, MAX_TITLE_LENGTH),
    paragraphIndex: paragraphIndex + 1,
    paragraphText,
    knowledgePointOrder: 0,
  };
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