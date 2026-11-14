import { NextResponse } from "next/server";
import { getPendingProposal } from "@/lib/plans/adjustment";

export async function GET() {
  const proposal = getPendingProposal();
  return NextResponse.json({ ok: true, proposal: proposal ?? null });
}