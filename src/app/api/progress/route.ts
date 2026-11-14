import { NextResponse } from "next/server";
import { getProgressSummary, reconcilePlan } from "@/lib/plans/progress";

export async function GET() {
  const adjustments = reconcilePlan();
  const summary = getProgressSummary();

  return NextResponse.json({ ok: true, summary, adjustments });
}