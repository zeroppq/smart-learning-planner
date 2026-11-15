"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface Goal {
  learning_goal_id: string;
  goal_text: string;
  daily_minutes: number;
}

interface RouteNode {
  knowledge_point_id: string;
  prerequisite_point_id: string | null;
  node_order: number;
  stage: "foundation" | "core" | "application";
  point_title: string;
  chapter_name: string;
  point_status: string;
}

interface Task {
  daily_task_id: string;
  task_date: string;
  knowledge_point_id: string;
  point_title: string;
  estimated_minutes: number;
  task_status: string;
}

interface PlanView {
  plan_id: string;
  plan_version: number;
  goal: Goal;
  route: RouteNode[];
  daily_tasks: Task[];
  today_tasks: Task[];
}

const stageLabel: Record<string, string> = {
  foundation: "基础",
  core: "核心",
  application: "应用",
};

const stageStyle: Record<string, string> = {
  foundation: "border-sky-200 bg-sky-50 text-sky-700",
  core: "border-violet-200 bg-violet-50 text-violet-700",
  application: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export default function PlanPage() {
  const [goalText, setGoalText] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState(40);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [view, setView] = useState<PlanView | null>(null);
  const [activeGoalId, setActiveGoalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showClarify, setShowClarify] = useState(false);
  const [rearrangePreview, setRearrangePreview] = useState<{
    dailyMinutes: number;
    before: { totalDays: number; maxTasksPerDay: number; minutesPerTask: number[] };
    after: { totalDays: number; maxTasksPerDay: number; minutesPerTask: number[] };
  } | null>(null);
  const [rearrangeBusy, setRearrangeBusy] = useState(false);

  const loadCurrent = useCallback(async () => {
    const response = await fetch("/api/plans/current");
    const data = (await response.json()) as { plan?: PlanView | null };
    if (data.plan) {
      setView(data.plan);
      setGoalText(data.plan.goal.goal_text);
      setDailyMinutes(data.plan.goal.daily_minutes);
      setActiveGoalId(data.plan.goal.learning_goal_id);
    }
  }, []);

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  const routeNodeMap = useMemo(() => {
    const map = new Map<string, RouteNode>();
    view?.route.forEach((node) => map.set(node.knowledge_point_id, node));
    return map;
  }, [view]);

  const taskGroups = useMemo(() => {
    const groups = new Map<string, Task[]>();
    view?.daily_tasks.forEach((task) => {
      const list = groups.get(task.task_date) ?? [];
      list.push(task);
      groups.set(task.task_date, list);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [view]);

  async function startPlanning(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("规划师正在确认你的目标…");

    try {
      const response = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalText, dailyMinutes }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        goal?: Goal;
        questions?: string[];
        error?: string;
      };

      if (!data.ok) {
        setNotice(data.error ?? "目标保存失败，请重试。");
        return;
      }

      const nextGoalId = data.goal?.learning_goal_id ?? "";
      const previousGoalId = view?.goal.learning_goal_id ?? "";
      const previousMinutes = view?.goal.daily_minutes;
      const isSameGoal = view !== null && nextGoalId === previousGoalId;

      if (isSameGoal) {
        setShowClarify(false);
        setQuestions([]);
        setActiveGoalId(nextGoalId);
        if (data.goal?.daily_minutes === previousMinutes) {
          setNotice("目标没有变化，当前计划保持不变。");
          return;
        }
        await previewRearrange();
        return;
      }

      const nextQuestions = data.questions ?? [];
      setActiveGoalId(nextGoalId);
      setQuestions(nextQuestions);
      setAnswers(nextQuestions.map(() => ""));

      if (nextQuestions.length > 0) {
        setShowClarify(true);
        setNotice("规划师想先确认 1-3 个信息，回答后生成计划；也可以直接跳过。");
      } else {
        setShowClarify(false);
        await requestPlan(nextGoalId, []);
      }
    } catch {
      setNotice("网络异常，目标没有保存成功。");
    } finally {
      setBusy(false);
    }
  }

  async function previewRearrange() {
    setBusy(true);
    setNotice("正在按新时长计算重排预览…");

    try {
      const response = await fetch("/api/plans/rearrange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: false }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        confirm: boolean;
        dailyMinutes?: number;
        before?: { totalDays: number; maxTasksPerDay: number; minutesPerTask: number[] };
        after?: { totalDays: number; maxTasksPerDay: number; minutesPerTask: number[] };
        error?: string;
      };

      if (!data.ok || !data.before || !data.after || typeof data.dailyMinutes !== "number") {
        setNotice(data.error ?? "重排预览失败，请重试。");
        return;
      }

      setRearrangePreview({ dailyMinutes: data.dailyMinutes, before: data.before, after: data.after });
      setNotice("已按新时长算好重排方案，确认后才会写入计划。");
    } catch {
      setNotice("网络异常，重排预览没有生成。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRearrange() {
    setRearrangeBusy(true);

    try {
      const response = await fetch("/api/plans/rearrange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        planVersion?: number;
        dailyMinutes?: number;
        error?: string;
      };

      if (!data.ok) {
        setNotice(data.error ?? "重排没有保存成功。");
        return;
      }

      setRearrangePreview(null);
      await loadCurrent();
      setNotice(`已按每天 ${data.dailyMinutes ?? ""} 分钟重排，计划版本升到 v${data.planVersion ?? ""}。`);
    } catch {
      setNotice("网络异常，重排没有保存成功。");
    } finally {
      setRearrangeBusy(false);
    }
  }

  async function submitClarify() {
    const goalId = activeGoalId || view?.goal.learning_goal_id || "";
    setBusy(true);
    await requestPlan(goalId, answers);
    setBusy(false);
  }

  async function requestPlan(goalId: string, answerList: string[]) {
    setNotice("规划师正在基于知识库里的真实知识点排路线…");

    try {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId, answers: answerList }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        plan?: PlanView;
        error?: string;
      };

      if (!data.ok || !data.plan) {
        setNotice(data.error ?? "计划生成失败，原计划保持不变。");
        return;
      }

      setView(data.plan);
      setShowClarify(false);
      setNotice(`计划已生成：共 ${data.plan.route.length} 个知识点，版本 v${data.plan.plan_version}。`);
    } catch {
      setNotice("网络异常，计划没有生成。");
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h1 className="text-lg font-semibold text-slate-900">学习计划</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          说出你想学什么，规划师会基于知识库里的真实知识点排出顺序和每日任务。
        </p>

        <form onSubmit={startPlanning} className="mt-4 space-y-3">
          <textarea
            value={goalText}
            onChange={(event) => setGoalText(event.target.value)}
            rows={3}
            placeholder="例如：我想在三周内学懂大学计算机基础，为期末考试做准备"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600">
              每天可用
              <input
                type="number"
                min={10}
                max={240}
                step={5}
                value={dailyMinutes}
                onChange={(event) => setDailyMinutes(Number(event.target.value))}
                className="mx-2 w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
              分钟
            </label>
            <button
              type="submit"
              disabled={busy || goalText.trim().length < 2}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {busy ? "处理中…" : "开始规划"}
            </button>
          </div>
        </form>

        {notice && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>
        )}
      </div>

      {showClarify && questions.length > 0 && (
        <div className="rounded-xl border border-slate-900 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">规划师想确认几件事</h2>
          <div className="mt-3 space-y-3">
            {questions.map((question, index) => (
              <label key={question} className="block text-sm text-slate-700">
                {index + 1}. {question}
                <input
                  value={answers[index] ?? ""}
                  onChange={(event) => {
                    const next = [...answers];
                    next[index] = event.target.value;
                    setAnswers(next);
                  }}
                  placeholder="可以留空"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void submitClarify()}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400"
            >
              生成计划
            </button>
            <button
              type="button"
              onClick={() => void requestPlan(activeGoalId || view?.goal.learning_goal_id || "", [])}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:text-slate-400"
            >
              按默认直接生成
            </button>
          </div>
        </div>
      )}

      {rearrangePreview && (
        <div className="rounded-xl border-2 border-slate-900 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">按新时长重排（需要你确认）</h2>
          <p className="mt-2 text-sm text-slate-700">
            每天可用时长改为 {rearrangePreview.dailyMinutes} 分钟后，每日任务安排变化如下，确认后才会写入计划。
          </p>

          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
              <div>
                <p className="font-medium text-slate-700">调整前</p>
                <p>共 {rearrangePreview.before.totalDays} 天有任务</p>
                <p>每天最多 {rearrangePreview.before.maxTasksPerDay} 项</p>
                <p>每项约 {rearrangePreview.before.minutesPerTask.join(" / ")} 分钟</p>
              </div>
              <div>
                <p className="font-medium text-slate-700">调整后</p>
                <p>共 {rearrangePreview.after.totalDays} 天有任务</p>
                <p>每天最多 {rearrangePreview.after.maxTasksPerDay} 项</p>
                <p>每项约 {rearrangePreview.after.minutesPerTask.join(" / ")} 分钟</p>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void confirmRearrange()}
              disabled={rearrangeBusy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:bg-slate-400"
            >
              {rearrangeBusy ? "重排中…" : "确认重排"}
            </button>
            <button
              type="button"
              onClick={() => setRearrangePreview(null)}
              disabled={rearrangeBusy}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:text-slate-400"
            >
              暂不重排
            </button>
          </div>
        </div>
      )}

      {view && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">知识点路线图</h2>
              <span className="text-xs text-slate-400">计划 v{view.plan_version}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              共 {view.route.length} 个知识点 · 点击查看前置依赖
            </p>

            <ol className="mt-3 space-y-2">
              {view.route.map((node) => {
                const prerequisite = node.prerequisite_point_id
                  ? routeNodeMap.get(node.prerequisite_point_id)
                  : null;
                const prerequisitePassed = prerequisite?.point_status === "passed";

                return (
                <li key={node.knowledge_point_id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">{node.node_order}</span>
                    <span className="min-w-0 flex-1 text-sm text-slate-900">{node.point_title}</span>
                    {node.prerequisite_point_id && (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${
                          prerequisitePassed
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {prerequisitePassed ? "前置已过" : "待前置"}
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        stageStyle[node.stage] ?? "border-slate-200 text-slate-600"
                      }`}
                    >
                      {stageLabel[node.stage] ?? node.stage}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {node.chapter_name || "未分章"}
                    {node.prerequisite_point_id
                      ? ` · 前置：${prerequisite?.point_title ?? node.prerequisite_point_id}`
                      : " · 无前置"}
                  </p>
                </li>
                );
              })}
            </ol>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">每日任务</h2>
            <p className="mt-1 text-xs text-slate-500">
              每天 {view.goal.daily_minutes} 分钟 · 共 {taskGroups.length} 天有任务 · 任务安排由知识点数量、学习周期与每日时长共同决定
            </p>

            <div className="mt-3 space-y-3">
              {taskGroups.slice(0, 3).map(([date, tasks]) => (
                <div key={date} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-xs font-medium text-slate-500">{date}</p>
                  <ul className="mt-1 space-y-1">
                    {tasks.map((task) => (
                      <li key={task.daily_task_id} className="flex flex-wrap items-center gap-2 text-sm text-slate-800">
                        <span className="min-w-0 flex-1">{task.point_title}</span>
                        <span className="text-xs text-slate-400">{task.estimated_minutes} 分钟</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {taskGroups.length > 3 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-500">
                  展开其余 {taskGroups.length - 3} 天
                </summary>
                <div className="mt-2 space-y-2">
                  {taskGroups.slice(3).map(([date, tasks]) => (
                    <div key={date} className="rounded-lg border border-slate-200 px-3 py-2">
                      <p className="text-xs font-medium text-slate-500">{date}</p>
                      <ul className="mt-1 space-y-1">
                        {tasks.map((task) => (
                          <li key={task.daily_task_id} className="flex items-center gap-2 text-sm text-slate-700">
                            <span className="min-w-0 flex-1">{task.point_title}</span>
                            <span className="text-xs text-slate-400">{task.estimated_minutes} 分钟</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  );
}