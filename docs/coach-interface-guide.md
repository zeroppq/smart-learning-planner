# 督学接口说明与交接字段

## 一句话职责

督学负责"今天把你按在桌前学完，并说实话你有没有学会"，不负责改计划、不负责排顺序。

## 系统提示词放在哪

`src/lib/agents/coach/system-prompt.ts`，与规划师的 `src/lib/agents/planner/system-prompt.ts` 同级隔离。改措辞只改这一个文件。

## 接口一：开始学习

`POST /api/coach/start`

| 项目 | 说明 |
|------|------|
| 输入 | `knowledgePointId`：要学的知识点 |
| 成功返回 | `point`（标题、章节、出处）、`standard`（三层标准全文）、`standardText`、`lecture`（讲解）、`mastery`、`next`（第一层复述要求） |
| 关键约束 | 判定标准必须在判定开始前完整返回；讲解必须基于知识库原文 |
| 失败返回 | 502/503 + 中文原因，不修改掌握状态 |

## 接口二：出题与判定

`POST /api/coach/judge`

| 项目 | 说明 |
|------|------|
| 输入 | `knowledgePointId`、`layer`（explain / practice / apply）、`question`、`answer`、可选 `rejudge`、`rejudgeNote` |
| 出题模式 | `question` 为空且 `layer` 为 practice/apply 时，返回 `needAnswer: true` 与题目，不判定、不写状态 |
| 判定模式 | 有 `question` 与 `answer` 时返回 `verdict`（pass / partial / fail）、`feedback`、`gaps`、`mastery`、`nextLayer` |
| 下一层规则 | 未通过 → 停留在原层；讲清楚通过 → 做对题；做对题通过 → 做出来；做出来通过 → done |
| 重判 | `rejudge: true` 时必须提供 `rejudgeNote`；每个知识点只能重判一次，第二次返回 400 |
| 失败返回 | 模型异常时返回中文提示，掌握状态保持判定前的值 |

## 接口三：开场抽查

`GET /api/coach/review`（到期复习）  
`GET /api/coach/review?manual=1`（立即抽查最近学过的知识点）

返回 `items`，每项包含知识点、章节、下次复习时间、状态和一道快速回忆题。抽查题生成失败时退回固定问法"请用你自己的话复述……"。

## 接口四：知识库答疑

`POST /api/coach/ask`

| 项目 | 说明 |
|------|------|
| 输入 | `question`，可选 `knowledgePointId` |
| 处理 | 关键词检索知识库段落，最多取 3 段；当前知识点优先 |
| 成功返回 | `answer` 与 `sources`（文档名 + 段落序号） |
| 无依据 | 检索为空时不调用模型，直接回答"当前资料未覆盖这个问题"，避免编造 |

## 三层判定规则

| 层 | 督学做什么 | 通过条件 | 不通过时 |
|----|------------|----------|----------|
| 讲清楚 | 要求学生复述并追问 | 能说清是什么、解决什么问题、与本章关系 | 指出缺口，留在本层重答 |
| 做对题 | 出题，含换问法的检查点 | 独立答对，能说清每一步 | 给反馈，允许重答；可申请重判一次 |
| 做出来 | 给应用型小任务，学生提交文字答案 | 步骤完整、能解释做法与结果 | 指出缺步骤，允许修改重提 |

## 交接字段（谁写、谁读、什么时候）

| 字段 | 含义 | 谁写 | 谁读 | 写入时机 |
|------|------|------|------|----------|
| `mastery_status` | not_started / learning / passed / needs_review | 督学 | 规划师、进度页 | 每次判定后 |
| `explain_result` | 讲清楚层结果 | 督学 | 规划师 | 讲清楚判定后 |
| `practice_result` | 做对题层结果 | 督学 | 规划师 | 做对题判定后 |
| `apply_result` | 做出来层结果 | 督学 | 规划师 | 做出来判定后 |
| `weak_point_flag` | 是否薄弱点（任一层 fail/partial） | 督学 | 规划师 | 每次判定后 |
| `review_due_at` | 下次复习日期（1 / 3 / 7 天） | 督学 | 规划师、抽查 | 三层全部通过后 |
| `review_count` | 已安排复习次数，用于选 1/3/7 天间隔 | 督学 | 督学 | 三层全部通过后 |
| `rejudge_used` | 是否已用过重判 | 督学 | 督学 | 首次申请重判时 |
| `plan_id` / `plan_version` | 当前计划 | 规划师 | 督学 | 计划生成或调整后 |
| `knowledge_point_id` | 知识点 | 规划师 | 督学 | 计划生成时 |

## 边界如何保证

1. 督学代码不导入任何计划写入函数；测试用例直接比对判定前后 `plan` 表内容完全一致。
2. 规划师不导入任何判定写入函数；判定只能通过督学接口发生。
3. 两个模块共用模型客户端与检索器，但提示词、可写表范围、可选模型完全分开。

## 模型配置

- 督学模型：`MODEL_NAME_COACH`（缺省回落 `MODEL_NAME`）
- 规划师模型：`MODEL_NAME_PLANNER`
- 接入地址与密钥：`MODEL_API_BASE_URL`、`MODEL_API_KEY`（只写在本地 `.env`）