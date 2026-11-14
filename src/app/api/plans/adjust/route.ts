import { NextResponse } from "next/server";
import { createAdjustmentProposal } from "@/lib/plans/adjustment";

export async function POST() {
  const result = createAdjustmentProposal();

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 200 });
  }

  return NextResponse.json({ ok: true, proposal: result.proposal });
}