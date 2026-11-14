# 材料三：五维评分对应表

| 维度 | 分值 | 本产品的拿分点 | 演示证据 | 证据文件 |
|------|------|----------------|----------|----------|
| 功能完备度 | 35 | 资料入库 → 定目标 → 出计划 → 每日学习 → 三层判定 → 进度可视化 → 计划调整，七个环节全部打通 | 3 分钟主线一次走完：上传、目标、计划、学一个点、看进度、调整确认，系统耗时 18.5 秒 | `docs/evidence/screenshots/2026-11-14-plan-page.png`、`2026-11-14-progress-page.png` |
| Agent 智能水平 | 20 | ①双智能体独立构建与结构化交接；②"讲清楚 → 做对题 → 做出来"三层递进判定；③基于知识库的引用式回答；④按进度自动顺延、按方案调整计划；⑤记录卡点与复习时间 | 督学判定未通过 → 规划师给出调整方案 → 用户确认 → 计划版本 v1 → v2 | `2026-11-14-plan-adjustment-proposal.png`、`2026-11-14-plan-adjustment-confirmed.png`、`docs/evidence/prompts/` |
| 场景应用价值 | 20 | 真实痛点：看得懂、做不出、不知道自己会不会；人群明确（大学生自学）；效果可量化（三层过关率、待回炉数量） | 三层判定样例展示"含糊回答被判不过"与"缺步骤被逐条指出" | `2026-11-14-judgment-讲清楚.png`、`2026-11-14-judgment-做对题.png`、`2026-11-14-judgment-做出来.png` |
| 码道使用深度 | 15 | 需求澄清、OpenSpec 提案、设计、编码、测试、文档、演示材料全流程在码道内完成；按任务组提交，保留排错记录 | 6 组问题与修复记录、分组 git log、提示词归档 | `docs/evidence/recordings/`、`docs/evidence/git-log/` |
| 创意与材料规范 | 10 | 差异化记忆点是"判定而不是讲解"；三层判定 + 双智能体交接协议；材料命名统一、目录清晰 | 四件材料 + 规范截图 + 分组记录 | `docs/materials/`、`docs/evidence/` |

## 与 proposal.md 的一致性

- 能力划分与 `proposal.md` 一致：knowledge-base、learning-plan、learning-session、progress-visualization、agent-collaboration。
- 演示主线与 `proposal.md` 一致：上传 → 说目标 → 出计划 → 学一个点 → 看进度 → 调整确认。
- 范围与 `proposal.md` 的"不做的事"一致：无注册登录、无 PPTX/DOCX、无薄弱点独立面板、无多目标并行。

## 材料自检

| 检查项 | 状态 |
|--------|------|
| 四件材料齐全 | 是（01-04） |
| evidence 四目录有实质内容 | 是（prompts / screenshots / recordings / git-log） |
| 截图命名规范 | 是（日期 + 页面/动作） |
| 文档与实现一致 | 是（接口、字段名、页面均可在代码中核对） |