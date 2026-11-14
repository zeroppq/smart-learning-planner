import { NextResponse } from "next/server";
import { getCurrentPlanView } from "@/lib/plans/repository";

export async function GET() {
  return NextResponse.json({ ok: true, plan: getCurrentPlanView() ?? null });
}