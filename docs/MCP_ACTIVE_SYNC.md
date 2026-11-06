# 主动同步 MCP

新增 `trigger_sync({sync_id?, retry_failed?})` 和只读 `get_sync_progress({sync_id?})`。保留原15项查询工具及参数；trigger_sync 是唯一标注为写入、会调用外部云的工具。

使用顺序：
1. 用户明确请求同步后调用 trigger_sync，不传 sync_id。
2. partial：保存 sync_id，以同一 ID 再调用 trigger_sync 接续。只查询进度不会推进数据采集。
3. running：等待返回的 poll_after_seconds，再查询 get_sync_progress。若转为 partial，继续第2步。
4. busy 且 requested_sync_started=false：现有历史批次持有全局租约，请等待后重新调用 trigger_sync，不要把旧任务 completed 当成新请求已完成。
5. 缓存可以在同步前、进行中或结束后读取；按请求日期及字段质量说明缺失和时效。completed_with_errors 时说明相关 failed_metrics，不能因另一日期失败拒绝已有数据。
6. failed：停止后续采集，仍可读取已入库缓存；不能自动重试登录。用户明确要求恢复失败任务时，可按 failure_recovery 传同一ID和 retry_failed:true 做一次有界恢复；再次失败立即停止。superseded：旧ID不能重启新任务，应重新检查当前任务。

运行方式：每次最多8页、循环时间预算18秒（全天心率单次请求上限30秒，其余沿用20秒；在途请求可以超过循环软预算），无后台无限循环。AI通过有限多次工具调用接续到完成。相同任务ID不重新请求已提交页；两分钟内完成结果直接复用。分页、去重和UPSERT复用既有核心。

范围固定北京时间今天和昨天，覆盖全部已有渠道及这两天的运动详情。历史回填任务不重置、不前移；全局D1租约防止它与实时同步并发执行。原始上游记录与版本保留，只接收云端新值/修订，不人为更改测量值。

返回同步ID、状态、完成比例、逐日指标成功/空结果/失败、固定错误码、最新观测时间、样本存储和入库时间，以及明确的 next_action。今天始终标记未完整，云端上传完整性未知。完成仅说明此次两天窗口已遍历，不代表未来不会再上传。

迁移0002仅在sync_jobs追加运行ID、开始时间和固定错误码三个字段；不重建健康表。旧迁移保持不变。

原生运动文件现已接入上述普通同步：每批在剩余时间预算内复用本次登录会话，最多查询1条今天/昨天缺失文件的下载地址，并最多下载1个文件。已保存或已有失败、空响应、checking记录的缓存不自动重抓。常规指标完成但仍有待获取文件时保持partial，使用同一sync_id续传；native_files显示独立状态。详见 [原生文件同步](NATIVE_WORKOUT_SYNC.md)。无需新增迁移或MCP工具。

新增网络故障诊断和明确恢复参数，见 [失败诊断与恢复](SYNC_FAILURE_RECOVERY.md)。旧 NETWORK_FAILURE 错误码保持兼容，未知的旧失败不会被推断为超时。

缓存读取不再以整轮同步完成为前提；兼容字段 data_analysis_allowed 明确降为缓存读取权限别名，不代表数据完整性或健康判断。详见 [缓存可读性与超时边界](CACHE_READ_AVAILABILITY.md)。
