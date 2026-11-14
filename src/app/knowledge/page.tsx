"use client";

import { useCallback, useEffect, useState } from "react";

interface Material {
  source_material_id: string;
  material_name: string;
  material_format: string;
  parse_status: string;
  paragraph_count: number;
  is_preset: number;
  knowledge_point_count: number;
}

interface KnowledgePoint {
  knowledge_point_id: string;
  point_title: string;
  chapter_name: string;
  paragraph_index: number;
  knowledge_point_order: number;
}

interface KnowledgePointDetail extends KnowledgePoint {
  paragraph_text: string;
  material_name: string;
}

const statusLabel: Record<string, string> = {
  success: "解析成功",
  failed: "解析失败",
  processing: "处理中",
};

const statusStyle: Record<string, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function KnowledgePage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [activeMaterialId, setActiveMaterialId] = useState<string | null>(null);
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [detail, setDetail] = useState<KnowledgePointDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refreshMaterials = useCallback(async () => {
    const response = await fetch("/api/materials");
    const data = (await response.json()) as { materials?: Material[] };
    setMaterials(data.materials ?? []);
  }, []);

  useEffect(() => {
    void refreshMaterials();
  }, [refreshMaterials]);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector<HTMLInputElement>('input[type="file"]');
    const file = input?.files?.[0];

    if (!file) {
      setNotice("请先选择一个文件。");
      return;
    }

    setUploading(true);
    setNotice("正在上传并解析…");

    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch("/api/materials", { method: "POST", body });
      const data = (await response.json()) as {
        ok: boolean;
        parseStatus?: string;
        knowledgePointCount?: number;
        error?: string;
        materials?: Material[];
      };

      if (!data.ok) {
        setNotice(data.error ?? "上传失败，请重试。");
      } else {
        setNotice(`上传成功，切分出 ${data.knowledgePointCount ?? 0} 个知识点。`);
      }

      if (data.materials) {
        setMaterials(data.materials);
      }
      form.reset();
    } catch {
      setNotice("网络异常，上传未完成，请重试。");
    } finally {
      setUploading(false);
    }
  }

  async function openMaterial(material: Material) {
    setActiveMaterialId(material.source_material_id);
    setDetail(null);

    if (material.parse_status !== "success") {
      setPoints([]);
      return;
    }

    const response = await fetch(`/api/materials/${material.source_material_id}/knowledge-points`);
    const data = (await response.json()) as { knowledgePoints?: KnowledgePoint[] };
    setPoints(data.knowledgePoints ?? []);
  }

  async function openPoint(point: KnowledgePoint) {
    const response = await fetch(`/api/knowledge-points/${point.knowledge_point_id}`);
    const data = (await response.json()) as { knowledgePoint?: KnowledgePointDetail };
    setDetail(data.knowledgePoint ?? null);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h1 className="text-lg font-semibold text-slate-900">知识库</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          上传你自己的课件、讲义或教材（支持 TXT、MD、PDF）。系统会解析成知识点，并保留原文出处。
        </p>

        <form onSubmit={handleUpload} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="file"
            accept=".txt,.md,.markdown,.pdf"
            className="w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
          <button
            type="submit"
            disabled={uploading}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {uploading ? "处理中…" : "上传并解析"}
          </button>
        </form>

        {notice && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>
        )}
        <p className="mt-2 text-xs text-slate-400">
          提示：PDF 解析不稳定时，请改用 MD 或 TXT；单个文件不超过 10MB。
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">资料列表</h2>

        {materials.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">还没有资料，先上传一份，或稍等预置课程载入。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {materials.map((material) => (
              <li key={material.source_material_id}>
                <button
                  type="button"
                  onClick={() => void openMaterial(material)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                    activeMaterialId === material.source_material_id
                      ? "border-slate-900 bg-slate-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 break-all text-sm font-medium text-slate-900">
                      {material.material_name}
                    </span>
                    {material.is_preset === 1 && (
                      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600">
                        预置
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        statusStyle[material.parse_status] ?? "border-slate-200 text-slate-600"
                      }`}
                    >
                      {statusLabel[material.parse_status] ?? material.parse_status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    格式 {material.material_format.toUpperCase()} · {material.paragraph_count} 段 ·{" "}
                    {material.knowledge_point_count} 个知识点
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {activeMaterialId && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">知识点</h2>
          {points.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              这份资料还没有可用知识点（可能解析失败）。
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {points.map((point) => (
                <li key={point.knowledge_point_id}>
                  <button
                    type="button"
                    onClick={() => void openPoint(point)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:bg-slate-50"
                  >
                    <span className="text-sm text-slate-900">
                      {point.knowledge_point_order}. {point.point_title}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">
                      {point.chapter_name ? `${point.chapter_name} · ` : ""}第 {point.paragraph_index} 段
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {detail && (
        <div className="rounded-xl border border-slate-900 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">原文出处</h2>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              关闭
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            来源：{detail.material_name} · 第 {detail.paragraph_index} 段
          </p>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {detail.paragraph_text}
          </pre>
        </div>
      )}
    </section>
  );
}