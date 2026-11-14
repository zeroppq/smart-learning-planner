export default function TodayPage() {
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h1 className="text-lg font-semibold text-slate-900">今日学习</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          这里将显示开场抽查、今日任务和三层判定。当前是工程骨架，功能按任务组逐步接入。
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-5">
        <p className="text-sm text-slate-500">
          还没有学习目标。先去
          <span className="mx-1 font-medium text-slate-700">学习计划</span>
          页面说出你想学什么。
        </p>
      </div>
    </section>
  );
}