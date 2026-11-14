import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "智学规划",
  description: "面向大学生的自学掌握度判定系统",
};

const navItems = [
  { href: "/", label: "今日学习" },
  { href: "/knowledge", label: "知识库" },
  { href: "/plan", label: "学习计划" },
  { href: "/progress", label: "进度" },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-slate-50 text-slate-900">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="shrink-0 text-base font-semibold text-slate-900">
              智学规划
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <span className="text-xs text-slate-400 sm:hidden">自学掌握度判定</span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 pb-24 pt-4 sm:px-6 sm:pb-8">
          {children}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white sm:hidden">
          <div className="grid grid-cols-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex min-w-0 flex-col items-center justify-center px-1 py-2 text-xs text-slate-600"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </body>
    </html>
  );
}