# 云端有界自动同步

无需Windows持续开机。本实现没有Worker原生cron；可由账户可用的Sites Automations/云端任务调用私有站点。具体可用性和计费依账户为准。

## 两条独立路径

- 用户说“同步今天数据”：MCP `trigger_sync`，`partial`时以同一 `sync_id` 继续，`running`等待再查询，失败停止。仅今天、昨天，不重置历史断点。
- 后台补全：所有者平台服务认证调用 `POST /api/sync`，空请求体。优先今天/昨天，完成后推进独立365天历史断点及已接入运动 operational 详情。它不会自动下载所有FDS运动文件。

## 建议任务提示词（替换占位符后使用）

> 更新我自己的所有者私有Site `<YOUR_SITE_PROJECT_ID>`、`<YOUR_SITE_ORIGIN>`。先读取get_site，确认调用者为所有者、允许列表只有所有者且无组/外部访客。取得当前平台siwc_bypass_bearer_token，仅在内存使用，仅向这个精确Site源站发送 `OAI-Sites-Authorization: Bearer ...`。不得读取小米Secrets、Token或Cookie。
>
> 顺序调用 `POST /api/sync`，空请求体，`X-Site-Sync-Intent: refresh`；每轮最多32次，遇到complete或already_current停止。遇到非200、认证失败、429、SYNC_BUSY、费用复核门限或网络结果不确定立即停止；不得绕过或重试登录。最后在结果确定且可安全读取时GET /api/sync-status，使用同样平台认证和意图头。只报告计数、覆盖日期、历史进度和固定错误码。今天必须标为未完整，不能虚构App未上传内容。不得改变私有权限、创建付费资源或让只读MCP触发同步。

例如每天08:15，时区明确设为Asia/Shanghai；创建后检查真实保存的计划。任务只保存占位符替换后的项目ID/源站，不保存Xiaomi Secret或平台bearer。

`OAI-Sites-Authorization` 是Sites消耗的服务访问头；它不同于小米Cookie和MCP原生用户身份。`X-Site-Sync-Intent` 仅表达意图，**不是密码或鉴权**。不能在公开Worker上照搬此调用流程。

当前采集器内有有限的上游短暂错误重试逻辑；不自动重新登录。任务层不得叠加无限重试或并发调用。当前源码存在2027-01-01费用复核门限，见复现指南。
