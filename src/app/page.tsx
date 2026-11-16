"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CitedText } from "@/components/cited-text";

interface PlanTask {
  daily_task_id: string;
  task_date: string;
  knowledge_point_id: string;
  point_title: string;
  estimated_minutes: number;
  task_status: string;
}

interface RouteNode {
  knowledge_point_id: string;
  point_title: string;
  point_status: string;
  node_order: number;
}

interface PlanView {
  plan_id: string;
  plan_version: number;
  goal: { learning_goal_id: string; goal_text: string; daily_minutes: number };
  route: RouteNode[];
  today_tasks: PlanTask[];
}

interface JudgeStandard {
  explain: string[];
  practice: string[];
  apply: string[];
  summary: string[];
}

interface Mastery {
  mastery_status: string;
  explain_result: string;
  practice_result: string;
  apply_result: string;
  rejudge_used: number;
}

interface JudgeGap {
  standard_index: number;
  detail: string;
}

interface Verdict {
  verdict: "pass" | "partial" | "fail";
  feedback: string;
  gaps: JudgeGap[];
  suggestions: string[];
}

interface ReviewItem {
  knowledgePointId: string;
  pointTitle: string;
  chapterName: string;
  question: string;
}

type Layer = "explain" | "practice" | "apply";

const layerLabel: Record<Layer, string> = {
  explain: "第一层：讲清楚",
  practice: "第二层：做对题",
  apply: "第三层：做出来",
};

const verdictLabel: Record<string, string> = {
  pass: "通过",
  partial: "部分通过",
  fail: "未通过",
};

const verdictStyle: Record<string, string> = {
  pass: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partial: "border-amber-200 bg-amber-50 text-amber-800",
  fail: "border-rose-200 bg-rose-50 text-rose-800",
};

const masteryLabel: Record<string, string> = {
  not_started: "未开始",
  learning: "学习中",
  passed: "已通过",
  needs_review: "待回炉",
};

export default function TodayPage() {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [pointTitle, setPointTitle] = useState("");
  const [pointChapter, setPointChapter] = useState("");
  const [lecture, setLecture] = useState("");
  const [lectureSource, setLectureSource] = useState<{
    materialName: string;
    paragraphIndex: number;
    paragraphText?: string;
  } | null>(null);
  const [standard, setStandard] = useState<JudgeStandard | null>(null);
  const [layer, setLayer] = useState<Layer>("explain");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [mastery, setMastery] = useState<Mastery | null>(null);
  const [lastSubmittedAnswer, setLastSubmittedAnswer] = useState("");
  const [rejudgeNote, setRejudgeNote] = useState("");
  const [rejudgeBusy, setRejudgeBusy] = useState(false);
  const [rejudgeNotice, setRejudgeNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewAnswers, setReviewAnswers] = useState<Record<string, string>>({});
  const [reviewResults, setReviewResults] = useState<Record<string, Verdict>>({});

  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [askSources, setAskSources] = useState<
    Array<{ materialName: string; paragraphIndex: number; paragraphText?: string; pointTitle: string }>
  >([]);

  const loadPlan = useCallback(async () => {
    const response = await fetch("/api/plans/current");
    const data = (await response.json()) as { plan?: PlanView | null };
    setPlan(data.plan ?? null);
  }, []);

  const autoReviewTriggered = useRef(false);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    if (!plan || plan.today_tasks.length === 0 || autoReviewTriggered.current) {
      return;
    }
    autoReviewTriggered.current = true;
    void autoReview();
  }, [plan]);

  const suggestedPoint = useMemo(() => {
    if (!plan) {
      return null;
    }
    return plan.route.find((node) => node.point_status !== "passed") ?? null;
  }, [plan]);

  async function beginLearning(knowledgePointId: string, title: string) {
    setBusy(true);
    setNotice("督学正在准备讲解与判定标准…");
    setActivePointId(knowledgePointId);
    setPointTitle(title);
    setLecture("");
    setLectureSource(null);
    setStandard(null);
    setVerdict(null);
    setLastSubmittedAnswer("");
    setRejudgeNote("");
    setRejudgeNotice(null);

    try {
      const response = await fetch("/api/coach/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledgePointId }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        point?: {
          pointTitle: string;
          chapterName: string;
          materialName?: string;
          paragraphIndex?: number;
          paragraphText?: string;
        };
        lecture?: string;
        standard?: JudgeStandard;
        mastery?: Mastery;
        next?: { layer: Layer; question: string };
        error?: string;
      };

      if (!data.ok) {
        setNotice(data.error ?? "督学准备失败，请重试。");
        return;
      }

      setPointTitle(data.point?.pointTitle ?? title);
      setPointChapter(data.point?.chapterName ?? "");
      setLecture(data.lecture ?? "");
      setLectureSource(
        data.point?.materialName && typeof data.point.paragraphIndex === "number"
          ? {
              materialName: data.point.materialName,
              paragraphIndex: data.point.paragraphIndex,
              paragraphText: data.point.paragraphText,
            }
          : null,
      );
      setStandard(data.standard ?? null);
      setMastery(data.mastery ?? null);
      setLayer("explain");
      setQuestion(data.next?.question ?? "");
      setAnswer("");
      setNotice("讲解与判定标准已展示，先看标准，再开始第一层。");
    } catch {
      setNotice("网络异常，督学没有准备好本次学习。");
    } finally {
      setBusy(false);
    }
  }

  async function requestNextQuestion(targetLayer: Layer) {
    const response = await fetch("/api/coach/judge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        knowledgePointId: activePointId,
        layer: targetLayer,
        question: "",
        answer: "",
      }),
    });
    const data = (await response.json()) as {
      ok: boolean;
      needAnswer?: boolean;
      question?: string;
      error?: string;
    };

    if (!data.ok || !data.question) {
      setNotice(data.error ?? "下一题生成失败，请稍后重试。");
      return;
    }

    setLayer(targetLayer);
    setQuestion(data.question);
    setAnswer("");
    setVerdict(null);
  }

  async function submitAnswer() {
    if (!activePointId) {
      return;
    }
    if (answer.trim().length === 0) {
      setNotice("先写下你的回答，再提交判定。");
      return;
    }

    setBusy(true);
    setNotice("督学正在判定…");

    try {
      const response = await fetch("/api/coach/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgePointId: activePointId,
          layer,
          question,
          answer,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        verdict?: "pass" | "partial" | "fail";
        retryPass?: boolean;
        feedback?: string;
        gaps?: JudgeGap[];
        suggestions?: string[];
        mastery?: Mastery;
        nextLayer?: Layer | "done";
        rejudgeUsed?: number;
        error?: string;
      };

      if (!data.ok) {
        setNotice(data.error ?? "判定未完成，请重试。");
        return;
      }

      if (data.verdict) {
        setVerdict({
          verdict: data.verdict,
          feedback: data.feedback ?? "",
          gaps: data.gaps ?? [],
          suggestions: data.suggestions ?? [],
        });
        setMastery(data.mastery ?? null);
        setLastSubmittedAnswer(answer);
        setAnswer("");
        setRejudgeNote("");
        setRejudgeNotice(null);

        if (data.nextLayer === "done") {
          setNotice(`${data.retryPass ? "补考通过。" : ""}三层全部通过，这个知识点已标记为已通过。`);
          await loadPlan();
        } else if (data.nextLayer && data.verdict === "pass") {
          await requestNextQuestion(data.nextLayer);
          setNotice(`${data.retryPass ? "补考通过。" : ""}已进入${layerLabel[data.nextLayer]}。`);
        }
      } else {
        setNotice("督学正在出题，请稍候…");
      }
    } catch {
      setNotice("网络异常，判定没有完成。");
    } finally {
      setBusy(false);
    }
  }

  async function submitRejudge() {
    if (!activePointId) {
      return;
    }
    if (rejudgeNote.trim().length < 2) {
      setRejudgeNotice("先写一两句补充说明，再申请重判。");
      return;
    }
    if (lastSubmittedAnswer.trim().length === 0) {
      setRejudgeNotice("还没有可重判的回答，请先提交一次回答。");
      return;
    }

    setRejudgeBusy(true);
    setRejudgeNotice("督学正在基于你上次的回答重新判定…");

    try {
      const response = await fetch("/api/coach/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgePointId: activePointId,
          layer,
          question,
          answer: lastSubmittedAnswer,
          rejudge: true,
          rejudgeNote,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        verdict?: "pass" | "partial" | "fail";
        retryPass?: boolean;
        feedback?: string;
        gaps?: JudgeGap[];
        suggestions?: string[];
        mastery?: Mastery;
        nextLayer?: Layer | "done";
        error?: string;
      };

      if (!data.ok) {
        setRejudgeNotice(data.error ?? "重判未完成，请重试。");
        return;
      }

      if (data.verdict) {
        setVerdict({
          verdict: data.verdict,
          feedback: data.feedback ?? "",
          gaps: data.gaps ?? [],
          suggestions: data.suggestions ?? [],
        });
        setMastery(data.mastery ?? null);
        setRejudgeNote("");
        setRejudgeNotice(null);

        if (data.nextLayer === "done") {
          setNotice("三层全部通过，这个知识点已标记为已通过。");
          await loadPlan();
        } else if (data.nextLayer && data.verdict === "pass") {
          await requestNextQuestion(data.nextLayer);
          setNotice("已进入" + layerLabel[data.nextLayer] + "。");
        }
      }
    } catch {
      setRejudgeNotice("网络异常，重判没有完成。");
    } finally {
      setRejudgeBusy(false);
    }
  }

  async function autoReview() {
    try {
      const response = await fetch("/api/coach/review");
      const data = (await response.json()) as { ok: boolean; items?: ReviewItem[] };
      if (data.ok && data.items && data.items.length > 0) {
        setReviewItems(data.items);
        setNotice("督学先抽查一下上次学过的内容，答不上来就回炉。");
      } else {
        setNotice("督学：今天有排定任务，建议从第一项开始；也可以随时问我问题。");
      }
    } catch {
      // 自动开场失败时保持页面静默，用户仍可手动点按钮
    }
  }

  async function triggerReview() {
    setBusy(true);
    setNotice("督学正在挑复习题…");
    try {
      const response = await fetch("/api/coach/review?manual=1");
      const data = (await response.json()) as { ok: boolean; items?: ReviewItem[]; error?: string };
      if (!data.ok) {
        setNotice(data.error ?? "抽查失败，请重试。");
        return;
      }
      setReviewItems(data.items ?? []);
      setReviewAnswers({});
      setReviewResults({});
      setNotice(data.items && data.items.length > 0 ? "抽查题已准备好。" : "还没有学过的知识点，先学一个再抽查。");
    } catch {
      setNotice("网络异常，抽查没有开始。");
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(item: ReviewItem) {
    const answerText = (reviewAnswers[item.knowledgePointId] ?? "").trim();
    if (answerText.length === 0) {
      setNotice("先写下抽查答案，再提交。");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/coach/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgePointId: item.knowledgePointId,
          layer: "explain",
          question: item.question,
          answer: answerText,
        }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        verdict?: "pass" | "partial" | "fail";
        feedback?: string;
        gaps?: JudgeGap[];
        suggestions?: string[];
        error?: string;
      };

      if (!data.ok || !data.verdict) {
        setNotice(data.error ?? "抽查判定失败。");
        return;
      }

      setReviewResults((previous) => ({
        ...previous,
        [item.knowledgePointId]: {
          verdict: data.verdict as Verdict["verdict"],
          feedback: data.feedback ?? "",
          gaps: data.gaps ?? [],
          suggestions: data.suggestions ?? [],
        },
      }));
      await loadPlan();
    } catch {
      setNotice("网络异常，抽查判定没有完成。");
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    if (askQuestion.trim().length < 2) {
      setNotice("先写下你的问题。");
      return;
    }

    setBusy(true);
    setNotice("督学正在查阅资料…");
    try {
      const response = await fetch("/api/coach/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: askQuestion, knowledgePointId: activePointId }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        answer?: string;
        sources?: Array<{
          materialName: string;
          paragraphIndex: number;
          paragraphText?: string;
          pointTitle: string;
        }>;
        error?: string;
      };

      if (!data.ok) {
        setNotice(data.error ?? "答疑失败，请重试。");
        return;
      }

      setAskAnswer(data.answer ?? "");
      setAskSources(data.sources ?? []);
      setNotice(null);
    } catch {
      setNotice("网络异常，答疑没有完成。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900">今日学习</h1>
          {plan && <span className="text-xs text-slate-400">计划 v{plan.plan_version}</span>}
        </div>

        {!plan && (
          <p className="mt-2 text-sm text-slate-600">
            还没有学习计划。先去「学习计划」页面说出你想学什么。
          </p>
        )}

        {plan && (
          <>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              目标：{plan.goal.goal_text} · 每天 {plan.goal.daily_minutes} 分钟
            </p>

            <div className="mt-3 space-y-2">
              {plan.today_tasks.length === 0 && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  今天没有排定的新任务，可以做一次抽查，或继续学习下一个知识点。
                </p>
              )}
              {plan.today_tasks.map((task) => (
                <div
                  key={task.daily_task_id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 transition hover:bg-slate-50"
                >
                  <span className="min-w-0 basis-full break-words text-sm text-slate-900 sm:basis-0 sm:flex-1">
                    {task.point_title}
                  </span>
                  <span className="text-xs text-slate-400">{task.estimated_minutes} 分钟</span>
                  <button
                    type="button"
                    onClick={() => void beginLearning(task.knowledge_point_id, task.point_title)}
                    disabled={busy}
                    className="ml-auto rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white disabled:bg-slate-400 sm:ml-0"
                  >
                    开始学习
                  </button>
                </div>
              ))}

              {plan.today_tasks.length === 0 && suggestedPoint && (
                <button
                  type="button"
                  onClick={() => void beginLearning(suggestedPoint.knowledge_point_id, suggestedPoint.point_title)}
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white disabled:bg-slate-400"
                >
                  继续学习：{suggestedPoint.point_title}
                </button>
              )}
            </div>
          </>
        )}

        {notice && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>
        )}
      </div>

      {activePointId && (
        <div className="rounded-xl border border-slate-900 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {pointTitle}
              {pointChapter ? ` · ${pointChapter}` : ""}
            </h2>
            {mastery && (
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600">
                {masteryLabel[mastery.mastery_status] ?? mastery.mastery_status}
              </span>
            )}
          </div>

          {lecture && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-600">督学讲解</p>
              <CitedText
                text={lecture}
                sources={lectureSource ? [lectureSource] : []}
                className="mt-1"
              />
            </div>
          )}

          {standard && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 shadow-sm">
              <p className="text-xs font-semibold text-amber-800">判定标准（开始判定前请先看完）</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {(["explain", "practice", "apply"] as Layer[]).map((key) => (
                  <div key={key}>
                    <p className="text-xs font-medium text-amber-800">{layerLabel[key]}</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-amber-900">
                      {standard[key].map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-amber-800">{standard.summary.join("；")}</p>
            </div>
          )}

          <div className="mt-3">
            <p className="text-xs font-medium text-slate-500">
              当前：{layerLabel[layer]}
              {question ? "" : "（等待督学出题）"}
            </p>
            {question && (
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-800">
                {question}
              </p>
            )}

            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              rows={4}
              placeholder="用你自己的话写下来，越具体越好"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitAnswer()}
                disabled={busy}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
              >
                提交判定
              </button>
{verdict && verdict.verdict !== "pass" && layer === "practice" && (
            <button
              type="button"
              onClick={() => void requestNextQuestion("practice")}
              disabled={busy}
              className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:text-slate-400"
            >
              换一道变式题
            </button>
          )}

          {verdict && verdict.verdict !== "pass" && mastery?.rejudge_used === 0 && (
                <span className="text-xs text-slate-500">判定不过时可以申请重判一次</span>
              )}
            </div>
          </div>

          {verdict && (
            <div className={`mt-3 rounded-lg border border-l-4 p-4 shadow-sm ${verdictStyle[verdict.verdict]}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-current bg-white/70 px-2.5 py-0.5 text-xs font-semibold">
                  {verdictLabel[verdict.verdict]}
                </span>
                <span className="text-xs opacity-80">本层判定结果</span>
              </div>
              <p className="mt-2 text-sm leading-6">{verdict.feedback}</p>

              {standard && (
                <div className="mt-3 space-y-1">
                  <p className="text-xs font-semibold">达标情况（对照本层标准）</p>
                  <ul className="space-y-1">
                    {standard[layer].map((item, index) => {
                      const gap = verdict.gaps.find((entry) => entry.standard_index === index + 1);
                      if (gap) {
                        return (
                          <li
                            key={index}
                            className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold leading-5 text-rose-800"
                          >
                            未达标：{item}
                            <span className="mt-0.5 block font-normal text-rose-700">{gap.detail}</span>
                          </li>
                        );
                      }
                      return (
                        <li
                          key={index}
                          className="rounded-md bg-white/60 px-2.5 py-1.5 text-xs leading-5 text-emerald-700"
                        >
                          已达标：{item}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {verdict.suggestions.length > 0 && (
                <div className="mt-2 rounded bg-white/40 px-2 py-1">
                  <p className="text-xs font-medium text-slate-700">督学建议（不影响判定）</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-700">
                    {verdict.suggestions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {verdict && verdict.verdict !== "pass" && mastery?.rejudge_used === 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4">
              <p className="text-sm font-semibold text-amber-900">申请重判（只能一次）</p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                基于你上次的回答与下面的补充说明重新判定。
              </p>
              <textarea
                value={rejudgeNote}
                onChange={(event) => setRejudgeNote(event.target.value)}
                rows={2}
                placeholder="补充说明你这次想澄清的点"
                className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-700"
              />
              {rejudgeNotice && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-xs text-amber-900">{rejudgeNotice}</p>
              )}
              <button
                type="button"
                onClick={() => void submitRejudge()}
                disabled={rejudgeBusy || rejudgeNote.trim().length < 2}
                className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {rejudgeBusy ? "重判中…" : "申请重判"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">开场抽查</h2>
          <button
            type="button"
            onClick={() => void triggerReview()}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 disabled:text-slate-400"
          >
            现在就抽查我
          </button>
        </div>

        {reviewItems.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            到期复习的知识点会在这里出现；也可以点按钮立即抽查。
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {reviewItems.map((item) => {
              const result = reviewResults[item.knowledgePointId];
              return (
                <div key={item.knowledgePointId} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-900">{item.pointTitle}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{item.question}</p>
                  <textarea
                    value={reviewAnswers[item.knowledgePointId] ?? ""}
                    onChange={(event) =>
                      setReviewAnswers((previous) => ({
                        ...previous,
                        [item.knowledgePointId]: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="写下你的回忆答案"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => void submitReview(item)}
                    disabled={busy}
                    className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white disabled:bg-slate-400"
                  >
                    提交抽查
                  </button>
                  {result && (
                    <p className={`mt-2 rounded-lg border px-3 py-2 text-xs ${verdictStyle[result.verdict]}`}>
                      {verdictLabel[result.verdict]}：{result.feedback}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">基于知识库答疑</h2>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            value={askQuestion}
            onChange={(event) => setAskQuestion(event.target.value)}
            placeholder="例如：为什么计算机用二进制？"
            className="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <button
            type="button"
            onClick={() => void ask()}
            disabled={busy}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:bg-slate-400"
          >
            提问
          </button>
        </div>

        {askAnswer && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <CitedText text={askAnswer} sources={askSources} />
            {askSources.length > 0 && (
              <details className="mt-2 rounded-lg border border-slate-200 bg-white/70 px-3 py-2">
                <summary className="cursor-pointer text-xs text-slate-500">
                  查看全部引用出处（{askSources.length} 段）
                </summary>
                <ul className="mt-2 space-y-2">
                  {askSources.map((source, index) => (
                    <li
                      key={`${source.materialName}-${source.paragraphIndex}-${index}`}
                      className="rounded border border-slate-200 bg-white px-2 py-1.5"
                    >
                      <p className="text-xs font-medium text-slate-600">
                        {source.materialName} · 第 {source.paragraphIndex} 段
                      </p>
                      {source.paragraphText ? (
                        <p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-500">
                          {source.paragraphText}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </section>
  );
}