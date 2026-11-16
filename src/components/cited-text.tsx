"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface CitationSource {
  materialName: string;
  paragraphIndex: number;
  paragraphText?: string;
}

interface TextPart {
  kind: "text";
  value: string;
}

interface CitationPart {
  kind: "citation";
  citationIndex: number;
  materialName: string;
  paragraphIndex: number;
}

type Part = TextPart | CitationPart;

const CITATION_PATTERN = /【\s*([^】\n]{1,120}?)\s*第\s*(\d+)\s*段\s*】/g;

export function splitCitations(text: string): Part[] {
  const parts: Part[] = [];
  let cursor = 0;
  let citationIndex = 0;

  for (const match of text.matchAll(CITATION_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push({ kind: "text", value: text.slice(cursor, start) });
    }
    citationIndex += 1;
    parts.push({
      kind: "citation",
      citationIndex,
      materialName: match[1].trim(),
      paragraphIndex: Number(match[2]),
    });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ kind: "text", value: text.slice(cursor) });
  }

  return parts;
}

function findSource(
  sources: CitationSource[],
  materialName: string,
  paragraphIndex: number,
): CitationSource | undefined {
  const sameIndex = sources.filter((source) => source.paragraphIndex === paragraphIndex);
  const named = sameIndex.find(
    (source) =>
      source.materialName === materialName ||
      source.materialName.includes(materialName) ||
      materialName.includes(source.materialName),
  );
  if (named) {
    return named;
  }
  return sameIndex.length === 1 ? sameIndex[0] : undefined;
}

export function CitedText({
  text,
  sources = [],
  className = "",
}: {
  text: string;
  sources?: CitationSource[];
  className?: string;
}) {
  const parts = useMemo(() => splitCitations(text), [text]);
  const [active, setActive] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active !== null && cardRef.current) {
      cardRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [active]);

  const activePart = parts.find(
    (part): part is CitationPart => part.kind === "citation" && part.citationIndex === active,
  );
  const activeSource = activePart
    ? findSource(sources, activePart.materialName, activePart.paragraphIndex)
    : undefined;

  return (
    <div className={className}>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
        {parts.length === 0
          ? text
          : parts.map((part, index) =>
              part.kind === "text" ? (
                <span key={index}>{part.value}</span>
              ) : (
                <sup key={index}>
                  <button
                    type="button"
                    data-citation={part.citationIndex}
                    aria-expanded={active === part.citationIndex}
                    aria-label={`查看出处：${part.materialName} 第 ${part.paragraphIndex} 段`}
                    onClick={() =>
                      setActive(active === part.citationIndex ? null : part.citationIndex)
                    }
                    className="ml-0.5 cursor-pointer rounded border border-slate-300 bg-white px-1 text-[10px] font-medium text-slate-600 transition hover:border-slate-900 hover:text-slate-900"
                  >
                    [{part.citationIndex}]
                  </button>
                </sup>
              ),
            )}
      </p>

      {activePart && (
        <div
          ref={cardRef}
          data-citation-card="true"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-amber-900">
              出处：{activeSource?.materialName ?? activePart.materialName} · 第{" "}
              {activeSource?.paragraphIndex ?? activePart.paragraphIndex} 段
            </p>
            <button
              type="button"
              onClick={() => setActive(null)}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
            >
              收起
            </button>
          </div>
          {activeSource?.paragraphText ? (
            <blockquote
              data-citation-paragraph="true"
              className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-amber-200 bg-white/80 p-2 text-xs leading-5 text-slate-700"
            >
              {activeSource.paragraphText}
            </blockquote>
          ) : (
            <p className="mt-2 text-xs leading-5 text-amber-900">
              原文片段未随本次回答返回；溯源信息以上方文档名与段落序号为准。
            </p>
          )}
        </div>
      )}
    </div>
  );
}