# 主动同步 MCP

新增 `trigger_sync({sync_id?, retry_failed?})` 和只读 `get_sync_progress({sync_id?})`。保留原15项查询工具及参数；trigger_sync 是唯一标注为写入、会调用外部云的工具。

使用顺序：
1. 用户明确请求同步后调用 trigger_sync，不传 sync_id。
2. partial：保存 sync_id，以同一 ID 再调用 trigger_sync 接续。只查询进度不会推进数据采集。
3. running：等待返回的 poll_after_seconds，再查询 get_sync_progress。若转为 partial，继续第2步。
4. busy 且 requested_sync_started=false：现有历史批次持有全局租约，请等待后重新调用 trigger_sync，不要把旧任务 completed 当成新请求已完成。
5. completed：读取 get_daily_summary；completed_with_errors：先说明 failed_metrics，再读取已有数据。
6. failed：停止；不能自动重试登录。仅在用户明确重试且问题已处理后传 retry_failed:true。superseded：旧ID不能重启新任务，应重新检查当前任务。

运行方式：每次最多8页、循环时间预算18秒（单个上游请求仍受20秒超时控制），无后台无限循环。AI通过有限多次工具调用接续到完成。相同任务ID不重新请求已提交页；两分钟内完成结果直接复用。分页、去重和UPSERT复用既有核心。

范围固定北京时间今天和昨天，覆盖全部已有渠道及这两天的运动详情。历史回填任务不重置、不前移；全局D1租约防止它与实时同步并发执行。原始上游记录与版本保留，只接收云端新值/修订，不人为更改测量值。

返回同步ID、状态、完成比例、逐日指标成功/空结果/失败、固定错误码、最新观测时间、样本存储和入库时间，以及明确的 next_action。今天始终标记未完整，云端上传完整性未知。完成仅说明此次两天窗口已遍历，不代表未来不会再上传。

迁移0002仅在sync_jobs追加运行ID、开始时间和固定错误码三个字段；不重建健康表。旧迁移保持不变。
