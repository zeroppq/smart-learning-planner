# agent-collaboration Specification

## Purpose
用两个职责清晰、彼此独立又互相交接的智能体完成"规划"与"督学"两件事，避免一个万能的聊天机器人什么都做一点、又什么都不深，同时让协同过程对用户与评审可见。

## Requirements

### Requirement: 双智能体职责分离

系统 MUST 由规划师与督学两个职责独立的智能体承担学习流程；规划师 MUST NOT 判定知识点是否掌握，督学 MUST NOT 修改阶段级计划。

#### Scenario: 督学遇到需要改计划

- **WHEN** 督学发现用户连续不过关或进度严重落后
- **THEN** 督学只上报事实与建议，由规划师生成调整方案

#### Scenario: 规划师被要求判分

- **WHEN** 用户在规划相关界面询问"我这样算学会了吗"
- **THEN** 规划师不给出掌握结论，引导用户进入督学的判定环节

### Requirement: 规划师触发条件

规划师 MUST 在以下时机被触发：新建学习目标、用户主动要求重新规划、督学上报进度异常。

#### Scenario: 新建目标触发

- **WHEN** 用户确认学习目标与每日时长
- **THEN** 规划师生成路线图与首阶段每日任务

#### Scenario: 督学上报异常

- **WHEN** 督学上报"连续 2 个知识点未通过"
- **THEN** 规划师生成一份调整方案，交由用户确认

### Requirement: 督学触发条件

督学 MUST 在以下时机被触发：用户进入今日学习页、用户完成一次作答、用户主动提问。

#### Scenario: 完成一次作答

- **WHEN** 用户提交某一层的回答
- **THEN** 督学给出该层的判定与理由，并决定进入下一层还是要求重做

### Requirement: 交接字段

两个智能体 MUST 通过结构化字段交接状态，至少包含 learning_goal_id、plan_id、plan_version、knowledge_point_id、mastery_status、mastery_layer_result、weak_point_flag、review_due_at。

#### Scenario: 督学向规划师交接

- **WHEN** 督学完成一次判定
- **THEN** 系统写入 mastery_status、mastery_layer_result、weak_point_flag 与 review_due_at，规划师可读取这些字段

#### Scenario: 规划师向督学交接

- **WHEN** 规划师生成或调整计划
- **THEN** 系统写入 plan_id、plan_version、knowledge_point_id 与 prerequisite_point_id，督学按最新版本执行

### Requirement: 协同过程可见

系统 MUST 在界面上标明当前动作由哪个智能体完成，使用户能区分"这是规划师在排计划"与"这是督学在判定"。

#### Scenario: 演示调整链路

- **WHEN** 督学判定未通过后触发规划师调整
- **THEN** 界面上先后出现"督学：判定未通过"与"规划师：提出调整方案"两个明确标识

### Requirement: 智能体失败可兜底

当任一智能体的输出不可用时，系统 MUST 给出可理解的错误提示，并 MUST NOT 让学习状态进入不一致。

#### Scenario: 规划师生成失败

- **WHEN** 路线图生成超时或返回内容无法解析
- **THEN** 系统提示"计划生成失败，请重试"，并保持原计划不变

#### Scenario: 督学判定失败

- **WHEN** 判定结果无法解析
- **THEN** 系统提示"本次判定未完成"，该知识点状态保持判定前的值
