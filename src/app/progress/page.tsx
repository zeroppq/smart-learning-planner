"use client";

import { useCallback, useEffect, useState } from "react";

interface ProgressNode {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
  pointStatus: string;
  nodeOrder: number;
  prerequisitePointId: string | null;
}

interface ProgressSummary {
  planId: string;
  planVersion: number;
  goalText: string;
  dailyMinutes: number;
  total: number;
  passed: number;
  learning: number;
  needsReview: number;
  notStarted: number;
  streakDays: number;
  dueReviewCount: number;
  lastStudied: { knowledgePointId: string; pointTitle: string; lastStudiedAt: string } | null;
  route: ProgressNode[];
}

interface AdjustmentChange {
  summary: string;
  before: { pendingTasks: number; overdueTasks: number; needsReview: number; planVersion: number };
  after: { extendedDays: number; tasksPerDay: number; newPlanVersion: number };
}

interface Proposal {
  adjustment_proposal_id: string;
  proposal_reason: string;
  change: AdjustmentChange;
}

const statusLabel: Record<string, string> = {
  not_started: "未学",
  learning: "学习中",
  passed: "已通过",
  needs_review: "待回炉",
};

const statusStyle: Record<string, string> = {
  not_started: "border-slate-200 bg-white text-slate-600",
  learning: "border-sky-200 bg-sky-50 text-sky-800",
  passed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_review: "border-amber-200 bg-amber-50 text-amber-800",
};

const legend = [
  { key: "not_started", label: "未学", color: "bg-white border-slate-300" },
  { key: "learning", label: "学习中", color: "bg-sky-50 border-sky-300" },
  { key: "passed", label: "已通过", color: "bg-emerald-50 border-emerald-300" },
  { key: "needs_review", label: "待回炉", color: "bg-amber-50 border-amber-300" },
];

export default function ProgressPage() {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [progressResponse, proposalResponse] = await Promise.all([
      fetch("/api/progress"),
      fetch("/api/plans/adjustment"),
    ]);
    const progressData = (await progressResponse.json()) as { summary?: ProgressSummary | null };
    const proposalData = (await proposalResponse.json()) as { proposal?: Proposal | null };
    setSummary(progressData.summary ?? null);
    setProposal(proposalData.proposal ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestAdjustment() {
    setBusy(true);
    setNotice("规划师正在根据进度生成调整方案…");
    try {
      const response = await fetch("/api/plans/adjust", { method: "POST" });
      const data = (await response.json()) as {
        ok: boolean;
        proposal?: Proposal;
        reason?: string;
      };

      if (!data.ok || !data.proposal) {
        setNotice(data.reason ?? "暂时不需要调整。");
        return;
      }

      setProposal(data.proposal);
      setNotice(null);
    } catch {
      setNotice("网络异常，调整方案没有生成。");
    } finally {
      setBusy(false);
    }
  }

  async function decide(action: "accept" | "reject") {
    if (!proposal) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/plans/adjustment/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.adjustment_proposal_id, action }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        planVersion?: number;
        error?: string;
      };

      if (!data.ok) {
        setNotice(data.error ?? "处理调整方案失败。");
        return;
      }

      setProposal(null);
      if (action === "accept") {
        setNotice(`已应用调整方案，计划版本升到 v${data.planVersion ?? ""}。`);
      } else {
        setNotice("已保持原计划不变。");
      }
      await load();
    } catch {
      setNotice("网络异常，调整方案没有处理成功。");
    } finally {
      setBusy(false);
    }
  }

  if (!summary) {
    return (
      <section className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-lg font-semibold text-slate-900">进度</h1>
          <p className="mt-2 text-sm text-slate-600">
            还没有学习计划。先去「学习计划」页面生成计划，再回来看进度。
          </p>
        </div>
      </section>
    );
  }

  const percent = summary.total === 0 ? 0 : Math.round((summary.passed / summary.total) * 100);

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900">进度</h1>
          <span className="text-xs text-slate-400">计划 v{summary.planVersion}</span>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          目标：{summary.goalText} · 每天 {summary.dailyMinutes} 分钟
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">已通过</p>
            <p className="mt-1 text-xl font-semibold text-emerald-700">
              {summary.passed}/{summary.total}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">待回炉</p>
            <p className="mt-1 text-xl font-semibold text-amber-700">{summary.needsReview}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">连续学习</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{summary.streakDays} 天</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs text-slate-500">到期复习</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{summary.dueReviewCount}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">整体掌握度 {percent}%</p>
        </div>

        {summary.lastStudied && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
            上次停在这里：{summary.lastStudied.pointTitle}（
            {summary.lastStudied.lastStudiedAt.slice(0, 10)}）
          </p>
        )}

        {notice && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">知识点路线图</h2>
          <button
            type="button"
            onClick={() => void requestAdjustment()}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:text-slate-400"
          >
            让规划师看看要不要调整
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {legend.map((item) => (
            <span key={item.key} className="flex items-center gap-1 text-xs text-slate-500">
              <span className={`inline-block h-3 w-3 rounded border ${item.color}`} />
              {item.label}
            </span>
          ))}
        </div>

        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {summary.route.map((node) => (
            <li
              key={node.knowledgePointId}
              className={`rounded-lg border px-3 py-2 ${statusStyle[node.pointStatus] ?? statusStyle.not_started}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-70">{node.nodeOrder}</span>
                <span className="min-w-0 flex-1 text-sm">{node.pointTitle}</span>
                <span className="text-xs opacity-80">{statusLabel[node.pointStatus] ?? node.pointStatus}</span>
              </div>
              <p className="mt-1 text-xs opacity-70">{node.chapterName || "未分章"}</p>
            </li>
          ))}
        </ol>
      </div>

      {proposal && (
        <div className="rounded-xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">规划师的调整方案（需要你确认）</h2>
          <p className="mt-2 text-sm text-slate-700">{proposal.proposal_reason}</p>

          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p>{proposal.change.summary}</p>
            <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              <div>
                <p className="font-medium text-slate-700">调整前</p>
                <p>待完成任务 {proposal.change.before.pendingTasks} 项</p>
                <p>过期任务 {proposal.change.before.overdueTasks} 项</p>
                <p>待回炉 {proposal.change.before.needsReview} 个</p>
                <p>计划版本 v{proposal.change.before.planVersion}</p>
              </div>
              <div>
                <p className="font-medium text-slate-700">调整后</p>
                <p>延展到未来 {proposal.change.after.extendedDays} 天</p>
                <p>每天约 {proposal.change.after.tasksPerDay} 项</p>
                <p>计划版本 v{proposal.change.after.newPlanVersion}</p>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void decide("accept")}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
            >
              确认调整
            </button>
            <button
              type="button"
              onClick={() => void decide("reject")}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:text-slate-400"
            >
              暂不调整
            </button>
          </div>
        </div>
      )}
    </section>
  );
}