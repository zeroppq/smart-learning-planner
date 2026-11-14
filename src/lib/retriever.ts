import { getDatabase } from "@/lib/db";

export interface RetrievedParagraph {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
  paragraphText: string;
  paragraphIndex: number;
  materialName: string;
  score: number;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(text: string): string[] {
  const normalized = normalize(text);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return Array.from(result);
}

interface PointRow {
  knowledge_point_id: string;
  point_title: string;
  chapter_name: string;
  paragraph_text: string;
  paragraph_index: number;
  material_name: string;
}

export function retrieveParagraphs(
  query: string,
  options: { limit?: number } = {},
): RetrievedParagraph[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const grams = bigrams(trimmed);
  if (grams.length === 0) {
    return [];
  }

  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT k.knowledge_point_id, k.point_title, k.chapter_name, k.paragraph_text,
              k.paragraph_index, m.material_name
         FROM knowledge_point k
         JOIN source_material m ON m.source_material_id = k.source_material_id
        WHERE m.parse_status = 'success'`,
    )
    .all() as unknown as PointRow[];

  const scored = rows.map((row) => {
    const haystack = normalize(`${row.point_title}${row.chapter_name}${row.paragraph_text}`);
    let score = 0;
    for (const gram of grams) {
      if (haystack.includes(gram)) {
        score += 1;
      }
    }
    if (normalize(row.point_title).includes(normalize(trimmed))) {
      score += 5;
    }

    return {
      knowledgePointId: row.knowledge_point_id,
      pointTitle: row.point_title,
      chapterName: row.chapter_name,
      paragraphText: row.paragraph_text,
      paragraphIndex: row.paragraph_index,
      materialName: row.material_name,
      score,
    };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 3);
}