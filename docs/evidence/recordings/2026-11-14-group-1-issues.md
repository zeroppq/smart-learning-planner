# 任务组 1（工程地基与数据层）问题与修复记录

- 日期：2026-11-14
- 对应提交：`d089126`（完成比赛版第一组）
- 记录方式：根据当时排错过程与 commit 信息回溯整理
- 记录目的：比赛"码道使用深度"过程材料

## 问题与修复

| 编号 | 现象 | 定位过程 | 修复方式 | 验证结果 |
|------|------|----------|----------|----------|
| 1 | 首次 `npm install` 长时间无输出，依赖装不上 | 检查 npm 源为 `registry.npmjs.org`，后台进程无输出、无进度 | 不改全局配置，单次命令加 `--registry=https://registry.npmmirror.com` | 59 秒安装完成 95 个包 |
| 2 | 安装时提示 esbuild 的 postinstall 被安全策略阻止 | npm 12 的 allowScripts 策略拦截安装脚本 | 未修改安全策略；直接运行 vitest 验证 | 测试正常运行，说明预编译二进制可用 |
| 3 | 原生 SQLite 驱动在 Windows 上可能编译失败 | 评估 `better-sqlite3` 需要 node-gyp 与 VS Build Tools | 改用 Node 24 内置 `node:sqlite`；design.md D2 补记原因 | 数据库读写、8 张表、跨进程持久化均通过 |
| 4 | 测试代码类型检查报 `Buffer` 不能作为 `BlobPart` | 上传接口测试用 `new File([buffer])`，TypeScript 严格模式不接受 `Buffer<ArrayBufferLike>` | 改为 `Uint8Array.from(content)` 再构造 File | `npm run typecheck` 通过 |
| 5 | 开发服务器启动后需要确认运行时能否用 `node:sqlite` | Next 打包是否兼容内置模块存在不确定性 | 增加 `/api/health`，在 Route Handler 里实际查询表结构 | 返回 `ok:true`、`tableCount:8` |

## 关键结论

1. 环境问题优先用"单次参数"解决，不擅自修改用户的全局配置。
2. 原生依赖是 4 天工期的高风险项，能换成内置能力就换。
3. 每个技术风险都要有可观察的验证点（健康检查、跨进程读写），不能只看编译通过。

## 验证结果

| 项目 | 结果 |
|------|------|
| 四个页面可访问 | 均返回 200 |
| 数据表 | 8 张，字段与 design.md D9 一致 |
| 模型客户端 | 正常返回、500 重试一次、超时中文提示、缺配置中文提示 |
| 数据持久化 | 进程 A 写入，进程 B 独立读出 |
| 单元测试 | 8 项通过 |