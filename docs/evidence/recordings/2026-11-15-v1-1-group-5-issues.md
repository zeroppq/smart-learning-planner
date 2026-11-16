# 任务组 5（体验优化 #2：知识点可读性）记录

- 日期：2026-11-15
- 对应变更：`openspec/changes/2026-11-15-v1-1-user-feedback`
- 记录目的：v1.1 迭代过程材料
- 硬约束：来源标注能力保留，数据层原文与溯字段未改动，仅改展示形态

## 任务与结果

| 任务 | 结果 |
|------|------|
| 5.1 讲解与答疑来源引用角标化 | 通过：新增 `src/components/cited-text.tsx`，把正文 `【文档名 第N段】` 解析为上标角标 `[1]`；点击展开「出处：文档名 · 第 N 段」卡片并展示命中段落原文，可收起；讲解由 `coach/start` 返回 `paragraphText`，答疑由 `coach/ask` 的 `sources` 返回 `paragraphText`，数据层原文与表结构未动 |
| 5.2 知识库知识点列表卡片化 | 通过：`listKnowledgePoints` 新增 `summary`（原文前 50 字）与 `material_name`；卡片展示标题、摘要、章节、来源文档与段落序号；点击卡片内展开详情原文与出处，再次点击收起 |
| 5.3 页面点击路径回归 | 通过：新增 `citation-badge`（角标 → 出处卡片 → 段落原文 → 收起）与 `knowledge-card-expand`（卡片列表 → 展开原文出处 → 收起）两条路径，脚本 `SUMMARY \| 通过 6/6` |

## 验收实测

| 项目 | 实测 |
|------|------|
| 讲解角标 | `citation-badge` PASS：讲解正文出现可点击角标，点击后出处卡片含文档名与「第 N 段」，并展示段落原文 |
| 答疑溯源 | 回答正文角标可展开；另保留「查看全部引用出处（N 段）」折叠区，文档名、段落序号与原文齐全 |
| 知识库卡片 | `knowledge-card-expand` PASS：预置课程知识点以卡片展示，摘要与来源段号可见，展开与收起均正常 |
| 全量用例 | `npm test` 15 文件 94 用例全部通过；`npm run typecheck` 通过 |
| 点击路径 | `node scripts/verify-ui-paths.mjs` → `SUMMARY \| 通过 6/6` |

## 用例数变化

| 文件 | 前 | 后 | 说明 |
|------|----|----|------|
| `src/components/cited-text.test.ts` | 新增 | 4 | 角标拆分、段号空格兼容、多引用编号递增、无引用原样保留 |
| 其余 15 个测试文件 | 90 | 90 | 不变 |
| **合计** | **90** | **94** | 只增不减 ✓ |

## 过程中的问题与修复

| 编号 | 现象 | 根因 | 修复 |
|------|------|------|------|
| 1 | `knowledge-card-expand` 首次运行报「展开后没有显示文档名与段落序号」 | 脚本用「原文出处」作就绪标志，误匹配知识库页顶部说明「并保留原文出处。」，详情尚未展开就被判为出现 | 就绪与消失断言改为带冒号的「原文出处：」，重跑 6/6 通过 |

## 证据位置

| 内容 | 位置 |
|------|------|
| 引用角标组件 | `src/components/cited-text.tsx` |
| 角标解析用例 | `src/components/cited-text.test.ts` |
| 知识点摘要字段 | `src/lib/materials/repository.ts`（`listKnowledgePoints`） |
| 点击路径 | `node scripts/verify-ui-paths.mjs` → `SUMMARY \| 通过 6/6` |
| 全量测试 | 15 文件 94 用例全部通过（退出码 0） |