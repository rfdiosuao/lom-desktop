# PA04 已有会话重新选择 MCP 服务

依据：Lom Personal Agent 架构 v2 §6 调度桥；桌面 PA04 需要给已经建好的个人助理会话补上调度工具，同时保留那条长期会话。

## 行为

- `PATCH /api/conversations/:id` 的 `extra.selected_mcp_server_ids` 表示重新选择这条会话的 MCP 服务：核心按创建时同样的规则重建 `mcp_server_ids` / `mcp_servers` / `mcp_statuses` 快照，并消费掉 `selected_mcp_server_ids`；其余 extra 照常合并。
- 已有的 `session_mcp_servers` 保留。团队会话的快照由团队编排负责，拒绝重新选择。
- 客户端仍不能直接写快照字段（`mcp_server_ids` 等），照旧返回 400。
- 新的选择在运行时下次启动（或重启）时生效。

## 验收

- AC-1 重新选择后快照包含新服务、状态条数一致、`selected_mcp_server_ids` 不残留、其他 extra 保留；直接写快照仍被拒绝（`crates/aionui-app/tests/pa04_mcp_reselect_e2e.rs`）。
