const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const action = process.argv[2] ?? "status";

async function get(path) {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, data: await response.json() };
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

function brief(text, max = 120) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

if (action === "status") {
  const progress = await get("/api/progress");
  const summary = progress.data.summary;
  console.log("PROGRESS", progress.status, "ok", progress.data.ok);
  console.log("ADJUSTMENTS", JSON.stringify(progress.data.adjustments));
  if (summary) {
    console.log(
      `COUNTS | 总数 ${summary.total} 已通过 ${summary.passed} 待回炉 ${summary.needsReview} 学习中 ${summary.learning} 未学 ${summary.notStarted}`,
    );
    console.log(`STREAK | ${summary.streakDays} 天 | 到期复习 ${summary.dueReviewCount}`);
    console.log("LAST |", brief(summary.lastStudied?.pointTitle, 40));
    console.log("VERSION |", summary.planVersion);
  }
  process.exit(0);
}

if (action === "create") {
  const result = await post("/api/plans/adjust");
  console.log("HTTP", result.status, "ok", result.data.ok);
  if (!result.data.ok) {
    console.log("REASON |", result.data.reason);
    process.exit(0);
  }
  const proposal = result.data.proposal;
  console.log("PROPOSAL_ID |", proposal.adjustment_proposal_id);
  console.log("REASON |", brief(proposal.proposal_reason, 140));
  console.log("SUMMARY |", brief(proposal.change.summary, 160));
  console.log("BEFORE |", JSON.stringify(proposal.change.before));
  console.log("AFTER |", JSON.stringify(proposal.change.after));
  process.exit(0);
}

if (action === "accept" || action === "reject") {
  const pending = await get("/api/plans/adjustment");
  const proposal = pending.data.proposal;
  if (!proposal) {
    console.log("NO_PENDING_PROPOSAL");
    process.exit(1);
  }
  const result = await post("/api/plans/adjustment/confirm", {
    proposalId: proposal.adjustment_proposal_id,
    action,
  });
  console.log("HTTP", result.status, "ok", result.data.ok, "action", action);
  console.log("PLAN_VERSION |", result.data.planVersion ?? "(unchanged)");
  console.log("ERROR |", result.data.error ?? "none");
  process.exit(0);
}

console.error("未知动作，可用：status / create / accept / reject");
process.exit(1);