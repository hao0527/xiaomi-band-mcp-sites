# 从零复现：ChatGPT Work + Sites

## 1. 先验证可用环境

在你的 Work 会话中确认 Sites 能创建私有项目、使用 D1 和后端 Secret，并能托管原生 MCP。缺少能力时停在本地合成测试，不改用无鉴权的公开 Worker。这里不假设所有 Plus 或 Work 账户拥有相同功能，也不承诺网络或资源免费。

## 2. 克隆与空库检查

运行 README 的 `npm ci`、`npm run typecheck`、`npm test`。`npm test` 只进行本地合成测试。若系统无法运行 Miniflare/workerd，先解决本地依赖，不以跳过测试代替通过。

仓库没有 `.env`，也不需要真实数据才能构建。不要导入别人的数据库、HAR、日志或凭据。原始实例的 Git 历史没有复制。

## 3. 新建私有 Site

由 Sites 创建**全新项目**，读取实际返回的 `project_id`；使用 Sites 官方流程将这个真实 ID 写入 `.openai/hosting.json`，不能自行编造。复制其他字段，保留 `d1: "DB"`、`r2: null`、`capabilities: ["mcp"]`。

本仓库是独立 Worker ESM，而不是 Python、Flask或FastAPI项目。使用所用版本的 Sites Worker ESM 发布流程：构建入口 `npm run build`，Worker ESM 在 `dist/server/index.js`，打包包括 `dist/.openai/hosting.json` 和平台要求的数据库迁移。不要直接上传 TypeScript 源文件当 Worker bundle；让当前 Sites 打包工具保留迁移。

Sites 自己的项目源仓库是运行项目的后续编辑来源；这个公开 GitHub 仓库是模板/复现来源，两者不自动同步。

### 数据库迁移

首次部署需按序应用：

1. `0000_personal_health.sql`：原始记录、版本、摘要、日志、基本视图。
2. `0001_live_and_metrics.sql`：历史断点、指标状态、步数参考、运动详情。
3. `0002_mcp_sync_progress.sql`：任务运行ID、开始时间和错误。
4. `0003_workout_native_cache.sql`：原生运动二进制文件缓存。

`drizzle/meta/_journal.json` 为该公开副本补全0003条目，便于全新空库安装；这不是对既有私人部署迁移历史的改写。`db/schema.sql` 是合成测试的完整空库结构，不能和四个迁移重复应用，也不能用它覆盖已有D1。

让 Sites 处理待应用迁移；检查数据库概览中 `workout_native_cache` 等表确实存在。应用过的迁移不重写。不要运行生成新0000的旧脚本；本仓库不携带该脚本。

## 4. 先部署空的私有环境

确认访问列表只有所有者，没有组或外部访客。先部署不含凭据的环境：

| 名称 | 类型与初始值 | 说明 |
|---|---|---|
| `MI_USER_ID` | 后续设为 Secret | 自己的小米账号ID |
| `MI_PASS_TOKEN` | 后续设为 Secret | 本地合法登录获得的passToken |
| `PERSIST_SYNC_ENABLED` | 普通变量 `false` | 首次授权前禁用采集 |
| `MI_LIVE_VALIDATION_ENABLED` | 普通变量 `false` | 保持旧诊断入口关闭 |
| `VERIFICATION_SERVICE_KEY` | 不必配置 | 旧诊断通道；不用于正常MCP连接/平台定时同步 |

`GET /api/preflight` 只检查是否配置，不打印值，也不请求小米。空库的只读 MCP 应能返回无记录/未开始，而不是虚构数据。

不要让 Work 调用读取 Secret 内容的工具；不要为了“检查配置”打印环境变量、哈希、前后缀或长度。只检查是否存在。

## 5. 手动配置与授权

在 **Site 的 Settings → 后端托管环境/Environment/Secrets** 界面，自己输入两项并开启 Secret 标记；界面名称可能随版本变化。不能使用 GitHub Secrets 替代 Sites 运行时 Secrets。

取得凭据的本地流程见 README，不在 Work、前端表单或聊天中处理密码。保存后将 `PERSIST_SYNC_ENABLED` 设为 `true`，重新发布私有版本使环境生效。此操作不意味着应自动开始登录；用户应再明确授权首次同步。

当前 `trigger_sync` 固定读取今天、昨天全部已配置渠道；**它不是只读一天步数的验收入口**。如果你只授权一步认证或一天步数，应先设计单独的受控验证，不可把 `trigger_sync` 当成该权限范围。

## 6. MCP安装与首次验证

Sites 发布包含 `mcp` 能力时创建个人 App/插件并提供身份保护。优先使用这个原生插件，不需要自己创建公网无鉴权 `/mcp`，也不需要本地长期运行 MCP 代理。

在 ChatGPT 的个人插件/由你创建的项目中找到该 Site 并连接。也可以让 Work 读取 `get_site(include_mcp_connection=true)` 返回的插件ID，并通过插件安装界面连接；**不要把平台访问令牌复制出来**。工具未刷新时新开会话或刷新连接。

先调用 `get_sync_status`、`list_available_metrics`。只有明确授权同步后才调用 `trigger_sync`，按返回的 next_action 接续；失败时停止，不自动重试登录。使用当前日期前先按 Asia/Shanghai 计算。

首次数据检查：对照手机同日期步数、睡眠起止/分期，检查返回的采样时间、入库时间及空结果。云端日报步数只有在该账号的源策略与App参考值独立验证后才被当成已验证总量；未验证时 `steps=null` 是有意行为，不应把分钟来源相加“修好”它。源码含所有者操作用步数参考/核验入口，操作说明见 `docs/MCP.md`。

## 7. 历史和运动文件

常规 MCP `trigger_sync` 仅增量刷新今天、昨天；历史由经过平台认证的有界 `/api/sync` 批次继续，不会被只读查询推动。见 AUTOMATION.md。

运动列表与 operational 详情进入常规批次；原生FDS文件是独立、按记录的受控检查，并非每条运动已自动下载。操作者可经所有者私有平台认证调用 `POST /api/activity-native-probe`，JSON仅含从自身运动列表取得的 `record_ref`；不得提供下载URL、AES密钥、Cookie或其他参数。查询曲线工具始终只读缓存。

该检查会用后端Secrets进行一次认证，并获取一个记录文件；先取得相应授权。重复请求复用缓存；已有失败/空缓存目前不会自动复查。格式8/v4、未压缩文件之外尚未验证解码；不要把空曲线解释成没有心率。

## 8. 费用与停机条件

自动化不属于代码内 Worker cron。先确认自己的平台能力/额度，然后按 AUTOMATION.md 创建独立云端任务。不创建额外付费资源。

当前冻结源码从 **2027-01-01 00:00 Asia/Shanghai** 起拒绝采集并返回 `HOSTING_COST_REVIEW_REQUIRED`。这是固定复核门限，不是Token过期，也不会删除既有数据；复现日期晚于门限时应先完成费用/配额复核，再由维护者明确调整，不能绕过它。停止采集不代表平台存储一定停止计费。

## 验收清单

- 合成测试通过；部署处于成功状态；迁移含0003。
- Site只有所有者可访问；未登录用户不能读取健康数据。
- Secret只在Sites后端；前端、MCP输出、日志和Git均无凭据。
- 新账号单独核验App口径；未知单位不标为已验证。
- 实时断点和历史断点独立；成功空结果不是零值。
- 对原生心率调用分页直到 `next_offset=null`；对普通明细跟随 `next_cursor`。
