import { NextResponse } from "next/server";
import { decideProposal } from "@/lib/plans/adjustment";

export async function POST(request: Request) {
  let payload: { proposalId?: unknown; action?: unknown };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "请求内容无法读取。" }, { status: 400 });
  }

  const proposalId = typeof payload.proposalId === "string" ? payload.proposalId : "";
  const action = payload.action === "accept" || payload.action === "reject" ? payload.action : null;

  if (!proposalId || !action) {
    return NextResponse.json(
      { ok: false, error: "缺少调整方案编号或处理动作。" },
      { status: 400 },
    );
  }

  const result = decideProposal(proposalId, action);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 409 });
  }

  return NextResponse.json({ ok: true, planVersion: result.planVersion ?? null });
}