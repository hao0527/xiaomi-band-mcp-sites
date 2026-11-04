# 可直接发给 ChatGPT Work 的复现提示词

请使用 https://github.com/hao0527/xiaomi-band-mcp-sites 在我的账号内创建全新的所有者私有 Sites MCP，定位是小米云数据同步与读取接口层。

先完整读取 README、docs/REPRODUCE_SITES.md、docs/SECURITY.md 和 docs/LIMITATIONS.md，核实我的账户实际拥有 Sites/D1/Secrets/原生MCP能力。不要承诺所有Plus账户都可用。缺少必要能力时先报告，不转为公开无鉴权Worker。

请先只完成无凭据复现：克隆/导入本仓库，运行 npm ci、npm run typecheck、npm test；测试数据全部为合成。新建一个所有者唯一访问的Site，使用Sites实际返回的新project_id，保留DB绑定和mcp能力，应用0000—0003迁移，构建并私有部署。不要覆盖已有Site，不购买资源。禁止导入任何个人健康数据或他人的站点ID。

部署后验证只读空库与Secrets配置机制，告诉我在哪里自己配置MI_USER_ID和MI_PASS_TOKEN。不要让我在对话里输入密码或Token，不要读取或回显Secret值，初始保持PERSIST_SYNC_ENABLED=false、旧诊断门限false。等我配置好并明确授权相应同步范围后再连接真实账号。

后续保留已实现功能与接口，不大规模重构、不扩展健康评分。若成本复核门限已到或出现认证/网络不确定，停止并报告固定错误码。数据存自己的私有D1，查询工具不触发采集。以仓库指南为准区分本地Mock、Sites云端和真实账号测试。
