import { readFileSync } from "node:fs";
import { chunkKnowledgePoints } from "../src/lib/materials/chunk.ts";
import { parseMaterial } from "../src/lib/materials/parse.ts";

const file = "docs/大学计算机基础_课堂讲义.md";
const buffer = readFileSync(file);
const parsed = await parseMaterial("大学计算机基础_课堂讲义.md", buffer);
const drafts = chunkKnowledgePoints(parsed.paragraphs);

console.log("PARAGRAPHS", parsed.paragraphs.length);
console.log("POINTS", drafts.length);

const emptyPoints = drafts.filter((draft) => {
  const body = draft.paragraphText.split("\n").slice(1).join("").trim();
  return body.length < 80;
});
console.log("THIN_POINTS", emptyPoints.length);
if (emptyPoints.length > 0) {
  emptyPoints.forEach((draft) => console.log("THIN |", draft.pointTitle, "|", draft.paragraphText.length));
}

console.log("FIRST_THREE");
drafts.slice(0, 3).forEach((draft, index) => {
  console.log(
    `  ${index + 1}. ${draft.pointTitle} | 章节=${draft.chapterName} | 段落=${draft.paragraphIndex} | 正文字数=${draft.paragraphText.length}`,
  );
});

const appendix = drafts.filter((draft) => draft.pointTitle.includes("附录"));
console.log("APPENDIX_POINTS", appendix.length);

const chapters = new Set(drafts.map((draft) => draft.chapterName));
console.log("CHAPTERS", chapters.size);
console.log("CHAPTER_NAMES", JSON.stringify([...chapters]));