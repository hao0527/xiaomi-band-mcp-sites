# MCP接口与数据读取

Sites原生托管 `/mcp`，平台认证，不对公网提供无鉴权工具。`server/discover`、`initialize`、`tools/list`、`tools/call` 使用当前实现的MCP 2026-07-28。工具返回结构化JSON与文本content；错误返回isError。

默认目录展示以下10项工具，旧20个工具名仍保留兼容调用；迁移与紧凑返回契约见 [MCP目录收敛](MCP_SURFACE.md)。

| 工具 | 参数摘要 | 行为 |
|---|---|---|
| trigger_sync | sync_id?、retry_failed? | 唯一MCP写入工具，今天/昨天有界增量 |
| get_sync_progress | sync_id? | 当前同步任务进度和后续动作 |
| get_sync_status | 日期范围?、metric? | 全局缓存状态及最多31天逐日覆盖 |
| list_available_metrics | 无 | 21类配置渠道及缓存/检查状态 |
| get_metric_records | metrics或metric、日期范围、cursor?、limit?、compact? | 通用单/多指标明细，返回record_ref |
| get_raw_record | record_ref、component?、offset?、limit?、snapshot_hash? | 脱敏原文分块、快照校验 |
| get_daily_summary | date或start_date/end_date | 原单日完整数据，或最多7日精简事实数据 |
| get_hrv_trend | 日期范围、cursor?、limit? | 睡眠HRV源字段；逐字段单位/对账元数据，不计算趋势 |
| get_activity_detail | record_ref、include_samples?、sample_limit? | 单次运动、operational缓存和来源标记 |
| get_activity_heart_rate_samples | record_ref、offset?、limit? | 原生曲线分页；不可用时明确标记分钟级回退 |

日期使用Asia/Shanghai的YYYY-MM-DD。新metrics调用默认每页200条、compact=true；包含heart_rate/resting_heart_rate时最多31天，其余90天。紧凑记录的metadata_ref需在同一页metadata_sets解析，不能跨页复用。旧metric调用保持每页2000条、完整元数据及原90天范围。所有明细limit上限仍为2000，具体schema以部署tools/list为准。

兼容调用保留get_sleep_records、get_heart_rate、get_activity_records、get_steps_records、get_spo2_records、get_stress_records、get_body_measurements、get_weekly_report、get_steps_audit、get_activity_heart_rate_analysis；它们退出默认目录，但不改原响应或鉴权。用metrics=["heart_rate","resting_heart_rate"]替代旧组合心率入口。日报范围从当前缓存重建；旧周报告仍读取已存日报，两者不混同。

## 同步调用状态机

参见 [MCP_ACTIVE_SYNC.md](MCP_ACTIVE_SYNC.md)。首次不传sync_id；partial用同一ID继续，running查询进度，completed读取数据，failed停止。不要把get_sync_progress当成会推进同步的后台任务。retry_failed仅在用户明确要求并已处理错误后使用，不能自动重试认证。

## 完整读取

普通明细跟随next_cursor直到null；更长日期分段读取，不能只取第一页就称为完整。原生曲线用get_activity_records取得本人record_ref，再调用get_activity_heart_rate_samples并把next_offset传回offset，直到null。不要把原生点间隔和传感器实际测量周期混淆。返回的来源、单位、confidence和截断状态应随数据一起交给AI。

## 新部署的步数验证

当前实现只在私有D1存在经核验的cloud_daily_aggregate策略时把日步数作为总量；没有策略时summary.steps可为null。原始分钟采样仍能读，不可直接跨来源求和。

仅所有者平台服务认证的操作员可用以下现有后台入口（它们不是MCP工具）：

1. `POST /api/steps-reference`，JSON `{"references":[{"date":"YYYY-MM-DD","steps":1234},...]}`；1234仅是形状示例，必须填写本人App真实参考。
2. `POST /api/steps-verify`，JSON `{"start":"YYYY-MM-DD","end":"YYYY-MM-DD"}`。

请求使用Sites平台服务认证和 `X-Site-Sync-Intent: refresh`，禁止用小米凭据作HTTP服务鉴权。需先同步所选日期的日报；单次实时trigger只覆盖今天和昨天，较早日期由历史回填带入。仅参考匹配并达到实现中的独立日期验证门槛才应用策略；不匹配时检查来源和日期，不能编辑原始数据凑数。

## 可信度

raw：源值；converted：单位/枚举转换；calculated：明确公式的计算。verified是实现对结构/单位/算术的验证，不是临床准确性认证。source_reported不等于已由App对账。unit=null或unverified时，不要猜测分钟/小时、HRV单位或热量范围。

HRV 详细契约与状态见 [HRV_SOURCE_PASSTHROUGH.md](HRV_SOURCE_PASSTHROUGH.md)。`supported=true` 仅说明存在读取路径，不能理解为单位、算法或临床精度已验证。

五个睡眠 HRV 汇总字段有所有者 App 对账的 ms 单位证据；其他字段不得沿用此单位。逐记录核对证据保存在私有 D1，仅精确匹配的日期/记录标记已对账。尚未获得夜间采样序列，未增加 get_hrv_samples。见 [HRV调查](HRV_UNIT_AND_SERIES_RESEARCH.md)。

完整原始读取及覆盖字段契约见 [RAW_READ_AND_COVERAGE.md](RAW_READ_AND_COVERAGE.md)。通用明细新增统一record_ref/source_ref，可追溯至同一条当前缓存原文，不触发同步。

原文组件、隔离数据语义及新旧运动缓存区别见 [SOURCE_PRESERVATION.md](SOURCE_PRESERVATION.md)。不增加新MCP工具；现有get_raw_record以可选component扩展。
