import { NextResponse } from "next/server";
import { generateReviewQuestion } from "@/lib/agents/coach/service";
import {
  getPointContext,
  listDueReviews,
  listRecentlyStudied,
} from "@/lib/agents/coach/repository";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const manual = url.searchParams.get("manual") === "1";
  const candidates = manual ? listRecentlyStudied(2) : listDueReviews(2);

  const items = await Promise.all(
    candidates.map(async (candidate) => {
      const point = getPointContext(candidate.knowledgePointId);
      if (!point) {
        return null;
      }
      const question = await generateReviewQuestion(point);
      return {
        knowledgePointId: candidate.knowledgePointId,
        pointTitle: candidate.pointTitle,
        chapterName: candidate.chapterName,
        reviewDueAt: candidate.reviewDueAt,
        masteryStatus: candidate.masteryStatus,
        question,
      };
    }),
  );

  return NextResponse.json({
    ok: true,
    mode: manual ? "manual" : "due",
    items: items.filter((item) => item !== null),
  });
}