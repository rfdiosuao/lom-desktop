# HIST-01 样本、接口与验证边界

- 需求：rfdiosuao/lom #38 / #85 / #86；总体验收 #151 保持开放。
- verified: ~/aion/protocols/samples/cli-history/2026-10-22/codex.jsonl
- verified: ~/aion/protocols/samples/cli-history/2026-10-22/claude.jsonl

以上为本机真实原始记录的最小采样，留在本机，未提交到 Git。tests/fixtures/*-captured.jsonl 只保留形状与类型/版本信息，其余字符串替换为 sample text / sample-session / /sample/project；不包含个人正文、密钥或真实绝对路径。其他合成夹具只测试损坏和边界，不作为协议证据。

参考过 AgentsView（MIT，ade0ab55a43d1e8198eb87e5aebb2e0e540512a9）的本地归档思路；没有复制上游代码或声称直接使用它的格式支持矩阵。新实现使用现有 serde/sha2/文件设施，不新增第三方依赖版本。CLI 存储格式按上述真实采样验证，不保证未来所有格式版本。

默认源：本机 ~/.codex/sessions、~/.codex/archived_sessions、~/.claude/projects。原始字节与元数据持久于独立 cli-history-v1，不修改已有 conversation 数据或数据库迁移。

路由：POST /api/lom/history/scan、POST /import、GET /api/lom/history、GET /{id}?offset、POST /{id}/bundle。共享 DTO 在 aionui-api-types/src/history_import.rs。仅持有启动令牌的本机桌面请求能访问；云端身份或运行时 helper 令牌不能替代。无启动令牌配置时不挂载。

归档 ID 为来源+原路径+内容摘要的 SHA-256；同来源文件内容变化形成新版本，不覆盖旧版。所有磁盘读取/解析运行在 spawn_blocking，由独立归档互斥锁序列化；不堵住其他核心业务。列表计数只统计元数据清单，未完成 .part 文件不作为会话。

本轮不是 SQLite 全文索引或任意规模流式归档：原文每文件最多2GB（流式、有界内存），目录项10000、单行1MB。超限诊断显式返回；大行/未知事件/加密字段只保证原始记录保留。分页预览可截短；转录导出不调用模型，不能当作语义摘要；附件仅引用，不复制媒体本体。

安全：UUID/路径由来源发现，提交只能选择当前仍存在的扫描快照；不接受用户传来的任意源路径，URL归档ID只接受64位十六进制。文件与祖先符号链接检查，内容摘要验证；同一操作系统用户能改文件的竞争不声称被强安全隔离。Unix私有权限，Windows继承ACL需真机另验。生产不记录原始内容/路径，只通过UI返回计数/稳定错误码。

流式版本真实本机 smoke 发现123个快照、0条诊断（消除了旧64MB阈值漏掉5个大文件的问题）；挑选Codex/Claude各1个真实样本，导入2、重试跳过2、读页及转录成功、来源摘要未变。仅此两个样本真实归档，不声称123个全部完成导入。此为 debug 构建，两次完整扫描及上述操作合计149676ms，不是发布版性能基准。原 CLI 不参与此流程，无模型调用。

未执行：Windows真机、原生桌面拖拽、人机权限/模型实际读取附件与继续任务、其他CLI、完整媒体备份、大规模吞吐/故障注入。现有附件链路静态追踪不替代真实模型验收。

后续流式修正：旧64MB阈值遗漏5个本机大文件，现已去除该阈值，改为2GB原文上限及约1MB分块处理/64KB流式复制，列表/分页不积累整个转录。预览会话路径只保留到本次扫描的进程内缓存；核心重启或新扫描替换后需重新扫描确认导入。

## HIST-02 title sources
Verified local captures: ~/aion/protocols/samples/cli-history/2026-10-23/title-shapes.sanitized.json.
- Codex local session_index.jsonl: observed keys id, thread_name, updated_at; read bounded, read-only and optional.
- Claude local JSONL: observed custom-title with sessionId and customTitle. No unobserved summary event is assumed to be a native title.
- Metadata titles take precedence over the first readable user question. Known environment/instruction preambles are not titles; no readable title becomes a neutral unnamed label.
- Existing archive list display can use a newer Codex title index without changing original archived bytes. No native CLI process restoration or model call is part of this crate change.
- Title lookup is a display-only local read; no new content logs are necessary, raw prompts and paths are not emitted.
