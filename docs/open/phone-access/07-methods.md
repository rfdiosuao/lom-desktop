# 07 RPC 方法清单

这是手机要实现的**功能清单**：桌面通过 [06](06-rpc-envelope.md) 的信封调用这些方法。每个方法一个小节，写明请求字段、响应字段、错误码、行为要点，并标注 **必需 / 可选**。

> 这里的方法是**手机要实现的 RPC**，不是 MCP 工具。桌面里有一座 MCP 桥给桌面自己的指挥 Agent 用，它会把工具调用翻译成这些 RPC，手机不需要、也看不到 MCP（对应关系见 [README](README.md#常见误解)）。

## 1. 必需与可选；不支持时怎么办

### 1.1 方法总表

| 方法 | 级别 | 说明 |
|---|---|---|
| `model.sync` | **必需** | 桌面把当前选中的模型配置（含密钥）发给手机 |
| `chat.send` / `chat.read` / `chat.list` / `chat.cancel` | **必需** | 发消息、读进度与历史、会话列表、停止——手机作为 Agent 的最小功能 |
| `document.list` / `document.read` | **必需（可返回空）** | 桌面每轮同步都会调用；不支持时请返回空列表，**不要**返回 `remote.method_unknown`（原因见 1.3） |
| `schedule.list` | **必需（可返回空）** | 同上 |
| `document.write` | 可选 | 编辑人格 / 记忆文档 |
| `device.capabilities` | 可选（**建议实现**） | 告诉桌面这台手机实现了哪些方法；桌面据此隐藏或置灰不支持的入口（见 §6） |
| `device.status` | 可选 | 电量与网络 |
| `device.rename` | 可选 | 桌面改手机名称 |
| `apps.list` | 可选 | 已安装应用与无障碍状态 |
| `chat.rename` / `chat.pin` / `chat.delete` | 可选 | 会话重命名、置顶、删除 |
| `chat.file` / `chat.image` | 可选 | 取会话里附件 / 图片 |
| `file.begin` `file.chunk` `file.finish` `file.read` `file.list` `file.delete` `file.save_gallery` | 可选 | 文件传输；`chat.send` 带附件、技能安装、`phone_send_image` 依赖它们 |
| `screen.capture` / `screen.tree` / `screen.control` | 可选 | 截图、界面树、代为点按 |
| `skills.list` `skills.read` `skills.install` `skills.toggle` `skills.delete` | 可选 | 技能管理 |
| `schedule.save` `schedule.toggle` `schedule.delete` `schedule.run` | 可选 | 定时任务管理 |
| `subagent.list` `subagent.save` `subagent.toggle` `subagent.delete` | 可选 | 子代理管理 |

### 1.2 不支持的方法必须返回什么

对任何自己不支持的方法，手机**必须**返回（而不是不回复或随便编一个结果）：

```json
{ "status": "error", "payload": "{}", "error": "remote.method_unknown" }
```

这是统一的「不支持」错误码。**不要**用空结果假装成功——桌面会据此认为操作已完成。

### 1.3 桌面看到不支持时怎么展示

| 调用场景 | 桌面表现 |
|---|---|
| `screen.*` | 提示「手机版本尚未支持画面，请安装新版 APK 后重试」，且不再自动重试 |
| `subagent.*` | 提示「当前手机版本不支持管理子代理，请更新手机 App」 |
| `device.status` | 静默降级：电量显示未知、网络显示「网络未知」；桌面诊断工具会报告 `remote.method_unknown` |
| `chat.rename` / `chat.pin` / `chat.delete` / `document.write` / `device.rename` / `skills.*` / `schedule.save` / `schedule.toggle` / `schedule.delete` / `schedule.run` / `file.*` | 对应操作失败，错误提示里带原始错误码 `remote.method_unknown`，界面不会改变 |
| `document.list` / `document.read` / `schedule.list` | **整轮同步判为失败**（同步在 `chat.list` → `document.list`/`read` → `schedule.list` 之间依次进行，任何一步抛错就中止），显示同步错误，并按 15 秒起翻倍、最长 5 分钟的间隔退避重试。所以不要对它们返回 `remote.method_unknown`：不支持就返回空集合（见各节） |
| `chat.send` / `chat.read` / `chat.list` / `chat.cancel` / `model.sync` | 手机基本不可用：发送失败、会话列表和进度读不到 |

**建议实现 `device.capabilities`**（§6）：手机用它主动声明自己实现了哪些方法，桌面就不会在界面上摆出点了只会失败的入口。没有实现它的手机，桌面按「全部支持」处理，行为与上表一致。

> 以上是桌面当前版本（0.3.x）的行为；后续版本可能调整提示文案，但「`remote.method_unknown` 表示未实现」的语义保持不变。

## 2. 通用约定

1. **载荷是 JSON 对象的文本**（见 [06 §3](06-rpc-envelope.md#3-内层消息)）：请求的 `payload` 是字符串，先 `JSON.parse` 再使用；响应的 `payload` 同理是 JSON 对象序列化成的字符串。
2. **除 `chat.*` 外，字段值几乎全是字符串**：数字、布尔值也用字符串表示（如 `"size": "1048576"`、`"enabled": "true"`、`"offset": "0"`）。`chat.*` 和 `document.list/read` 的响应里保留了真实的 JSON 数字 / 布尔。下面每个字段都写明了类型，请按表实现，**不要自行统一**。
3. 响应里的「**JSON 文本**」字段（如 `items`）表示：该字段的值是一个字符串，字符串内容是一段 JSON（数组 / 对象）。桌面会对它再 `JSON.parse` 一次。
4. 请求里的**未知字段忽略**；响应只放本页定义的字段，不要夹带额外信息（尤其是敏感内容）。
5. 每个方法必须在 **15 秒内**返回（[05 §4](05-relay.md#大小与时间限制)）。耗时任务（聊天推理、定时任务运行）先返回「已接受」，由桌面用 `chat.read` 等方法轮询。
6. 回复明文 ≤ 350,000 字节，需要分页或缩图时自行处理。
7. **所有修改类方法只有真正完成才返回 `ok`**（桌面据此更新界面）；做不到就返回明确的错误码，不允许「假成功」。
8. 范围隔离：模型配置、文件传输、幂等回执等状态按**发送方桌面的公钥**隔离（同一手机配对了多台桌面时互不可见）。
9. 错误码格式 `^[a-z_]+\.[a-z_]+$`（见 [06 §7](06-rpc-envelope.md#7-回复里的错误码规则)）。下面每个方法列出它**应当使用**的错误码；表里没有的情况自行选用同命名风格的码，或用 `remote.operation_failed`。

### 幂等与结果未知

桌面在「请求发出但回复没到（超时 / 断连）」时**不知道手机有没有执行**，所以会把原操作的幂等键保留下来，用同一个键重发或查询。手机必须配合：

| 方法 | 幂等键 | 手机要做的 |
|---|---|---|
| `chat.send` | `client_id` | 先**持久化收据**再启动任务；相同 `client_id` + 相同内容 → 直接返回原收据，不重复执行；相同 `client_id` + 不同内容 → `chat.id_reused` |
| `schedule.run` | `request_id` | 同上；收据同样持久化 |
| `screen.control` | `request_id` | 先写「结果未知」收据，执行后更新为「已完成」；同键重发时：已完成 → 返回原结果；仍是「未知」→ `screen.previous_result_unknown`（绝不重复点按）；内容不同 → `screen.id_reused` |
| `file.begin`/`file.chunk` | 文件 `id` + `offset` | 可续传：见 `file.*` |
| 带 `revision` 的写入 | `revision` | 版本不匹配 → `sync.conflict`，**不覆盖** |

手机进程重启后，已接受但未完成的 `chat.send` 任务应标记为 `interrupted`，**不得自动重新执行**（任务可能有外部副作用）。

### 通用错误码

| 错误码 | 含义 |
|---|---|
| `remote.method_unknown` | 方法不支持 |
| `remote.not_ready` | 手机端服务尚未就绪 |
| `sync.conflict` | `revision` 与手机当前版本不一致；写入被拒绝，桌面会保留用户草稿并提示重新载入 |

---

## 3. 模型

### `model.sync`（必需）

桌面把当前选中的模型提供商配置发给手机，手机据此调用模型。桌面在以下时机调用：新配对成功后、发送消息前（配置变化时）、收到 `chat.model_missing` 后。

请求：

| 字段 | 类型 | 说明 |
|---|---|---|
| `base_url` | string | 模型服务地址，**必须是 `https://`**，不得含用户名密码 / 查询串 / 片段；去掉末尾 `/` |
| `api_key` | string | 模型密钥；非空且 ≤ 16384 字符 |
| `model` | string | 模型名；非空且 ≤ 256 字符 |
| `platform` | string | 协议：`openai` / `openai-responses` / `anthropic` / `gemini`；其他值 → `model.unsupported_protocol` |
| `revision` | string | 十进制整数（桌面用毫秒时间戳），同一桌面单调不减 |

响应：`{ "status": "saved", "model": "<model>", "revision": "<revision>" }`。

行为：

- 配置**按发送方桌面公钥**保存为该桌面对应的模型提供商，并设为这台桌面发来任务时的默认模型；
- `revision` 小于已保存值 → `model.stale_revision`（拒绝倒退），等于或大于则接受；
- `api_key` 只能存进**加密凭据库**，不得写入日志、会话缓存、错误信息或云端；
- 错误码：`model.invalid_url`、`model.invalid_config`、`model.unsupported_protocol`、`model.stale_revision`。

## 4. 对话

### `chat.send`（必需）

向手机的原生 Agent 发一条消息并启动任务；**立即返回**，任务在后台执行。

请求：

| 字段 | 类型 | 说明 |
|---|---|---|
| `client_id` | string | 幂等键，16–64 个 `[A-Za-z0-9-]` 字符（桌面用 UUID） |
| `session_id` | string | 续写的会话 ID；**空串表示新建会话** |
| `text` | string | 用户消息；`trim` 后若为空且有附件，视为「请查看附件。」；UTF-8 ≤ 60,000 字节 |
| `files` | string（JSON 文本） | 已通过 `file.*` 传好的附件 ID 的 JSON 数组，如 `"[\"id1\"]"`；无附件为 `"[]"`；≤ 10 个。缺省按 `"[]"` 处理 |

响应：`{ "session_id": "<会话ID>", "client_id": "<同请求>", "status": "accepted" }`。桌面只使用 `session_id`。

行为：

- 校验 → **持久化收据** → 启动任务 → 返回，顺序不可颠倒（见上节「幂等」）；
- 同一会话已有任务在运行 → `chat.busy`；
- 这台桌面还没有通过 `model.sync` 下发模型 → `chat.model_missing`（桌面会自动重新 `model.sync` 并用同一个 `client_id` 重试一次）；
- 新建会话时，标题取消息前若干字；
- 错误码：`chat.invalid_id`、`chat.invalid_text`、`chat.id_reused`、`chat.model_missing`、`chat.session_missing`、`chat.busy`、`chat.receipt_failed`，以及附件相关的 `file.invalid_id`、`file.too_many`、`file.missing`、`file.incomplete`。

### `chat.read`（必需）

读取会话的消息与运行状态。任务运行期间桌面约每 0.5–1.5 秒调用一次（界面不可见时约 8 秒一次），每次从上次已知位置往前 2 条开始读。

请求：

| 字段 | 类型 | 说明 |
|---|---|---|
| `session_id` | string | 会话 ID |
| `offset` | **JSON 数字** | 从第几条开始，≥ 0，默认 0 |

响应：

| 字段 | 类型 | 说明 |
|---|---|---|
| `items` | array | 从 `offset` 起最多 **50** 条消息，**按时间从旧到新** |
| `total` | number | 会话消息总数 |
| `next` | number | `offset + items.length`；桌面循环读到 `next >= total` 为止 |
| `running` | boolean | 当前是否有任务在运行 |
| `status` | string | 运行中为 `"running"`；否则为最近一次任务的结果：`completed` / `failed` / `timeout` / `cancelled` / `interrupted`，从未运行过为 `idle` |
| `error` | string | 无错误为 `""`；失败时给一句简短说明，**不要包含密钥或内部细节** |

`items[]` 的每条消息：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 消息 ID，**稳定不变**（流式输出中同一条消息的 ID 不能变） |
| `role` | string | `user` 或 `assistant`；其他角色桌面忽略 |
| `text` | string | 消息文本（有 `blocks` 时作为汇总的兜底） |
| `at` | number | 毫秒时间戳 |
| `attachments` | string[] | 可选，附件文件名列表（下标用于 `chat.file`） |
| `blocks` | array | 可选，**有序**内容块（assistant 消息）；有 `text` 块时桌面按块逐个展示、忽略汇总 `text` |

`blocks[]`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 块 ID，稳定 |
| `kind` | string | `text`（正文）或 `tool_use`（工具调用）；其他种类（如思考过程）桌面忽略，**建议不要下发思考内容** |
| `title` | string | 工具名（`tool_use`） |
| `text` | string | 正文内容或工具输出 |
| `status` | string | `tool_use` 的状态：`PENDING` / `STREAMING` / `RUNNING` → 执行中；`SUCCESS` → 已完成；`FAILED` / `TIMEOUT` → 失败；`CANCELLED` → 已取消 |
| `command` | string | 可选，工具执行的命令摘要 |

要点：

- **分页必须有进展**：`offset < total` 时 `next` 必须大于 `offset`，否则桌面报「手机历史记录分页异常」；
- 消息顺序与 ID 要稳定，桌面靠 ID 判断重读的尾部是否与已有内容对齐；
- 错误码：`chat.session_missing`。

### `chat.list`（必需）

请求：`{ "offset": 0 }`（**JSON 数字**，≥ 0）。

响应：

| 字段 | 类型 | 说明 |
|---|---|---|
| `items` | array | 从 `offset` 起最多 **100** 个会话，按最近更新时间从新到旧 |
| `total` | number | 会话总数 |
| `next` | number | `offset + items.length` |

`items[]`：`id`（string）、`title`（string，缺省「新的会话」）、`updated`（number，毫秒）、`pinned`（boolean）、`running`（boolean，是否有任务在运行）、`model`（string，可选）。

桌面据此同步会话索引；手机上已删除的会话，桌面会在下一轮同步里把它去掉。

### `chat.cancel`（必需）

请求：`{ "session_id": "…" }`。响应：`{ "status": "cancelled", "session_id": "…" }`。

**停止要真的完成才能回复**：调用手机原生取消，等执行协程退出，再返回。桌面收到回复才会显示「已停止」；如果超时（结果未知），桌面显示「手机尚未确认停止」，不会假装已停。会话不存在 → `chat.session_missing`；会话本来就没在运行也返回成功。

### `chat.rename` / `chat.pin` / `chat.delete`（可选）

请求都带 `session_id`（string），另有：

| 方法 | 额外字段 | 响应 |
|---|---|---|
| `chat.rename` | `title`（string，trim 后 1–200 字符） | `{ "status": "saved", "session_id": … }` |
| `chat.pin` | `pinned`（**JSON 布尔**） | `{ "status": "saved", "session_id": … }` |
| `chat.delete` | — | `{ "status": "deleted" }`；会话已不存在也返回 `deleted`；会话正在运行 → `chat.busy`（拒绝删除） |

错误码：`chat.session_missing`、`chat.invalid_title`、`chat.busy`。桌面得到成功回执后才修改界面，随后重新拉取会话列表。

### `chat.file`（可选）

把某条消息的附件登记为可读取的文件。请求：`{ "session_id", "message_id", "index" }`（`index` 是**十进制字符串**，对应该消息 `attachments` 的下标）。响应：一个 **`FileState`**（见 `file.*`，`status` 为 `complete`），桌面随后用 `file.read` 分片读取。

只允许导出该消息里真实存在的附件，**不接受调用方给出的任意路径**。错误码：`file.message_missing`、`file.attachment_missing`、`file.invalid_source`、`file.quota_exceeded`。

### `chat.image`（可选）

把 Agent 回复里提到的一张图片登记为可读取的文件。请求：`{ "session_id", "source" }`，`source` 是回复文字里出现的图片引用（格式由手机端自己的 Agent 决定，例如沙箱内的路径或自定义地址）。响应同 `chat.file`（`FileState`，`status: "complete"`）。

安全要求：**只能读取该会话沙箱内的图片**，不得读取手机上的任意路径；文件类型限图片（PNG / JPEG / GIF / WebP），≤ 15 MiB（桌面端的内嵌显示上限）。错误码：`chat.session_missing`、`image.changed_during_read`、`file.quota_exceeded`。

## 5. 文档（人格与记忆）

文档名只有三类：`SOUL.md`（人格）、`GLOBAL.md`（全局记忆）、`YYYY-MM-DD.md`（按日记忆）。其他名字 → `sync.invalid_name`。单文档 ≤ 150,000 字节（UTF-8）。

`revision` 对桌面是**不透明字符串**，规则只有一条：内容变了它就必须变，内容没变就不变。官方实现用「文档 UTF-8 内容的 SHA-256 十六进制小写」，文件不存在按空文本处理。

### `document.list`（必需，可返回空）

请求 `{}`。响应：

```json
{ "items": [ { "name": "SOUL.md", "revision": "…", "modified": 1767222000000 } ] }
```

`modified` 是**毫秒时间戳（JSON 数字）**。顺序：`SOUL.md`、`GLOBAL.md`，然后按日期从新到旧的日记忆。不支持文档时返回 `{ "items": [] }`。

### `document.read`（必需）

请求 `{ "name": "SOUL.md" }`。响应 `{ "name", "text", "revision", "modified" }`（`text` 是全文）。文档不存在时 `text` 为 `""`。

### `document.write`（可选）

请求 `{ "name", "text", "revision" }`，`revision` 是桌面上次读到的版本。响应同 `document.read`（写入后的最新快照）。

行为：写入前比较当前版本，**不一致 → `sync.conflict`，不写入**；一致则先备份旧内容，写入临时文件，再原子替换，最后返回新快照。错误码：`sync.invalid_name`、`sync.document_too_large`、`sync.conflict`、`sync.write_failed`。

## 6. 设备信息

### `device.capabilities`（可选，建议实现）

手机用它声明**自己真正实现了哪些方法**，以及少量数值上限。桌面在配对成功后和每次连上手机时调用一次，并按设备缓存结果；据此决定手机页面里哪些入口显示、隐藏或置灰。这是 `v=1` 范围内新增的可选方法（见 [08](08-errors-security.md#版本与兼容策略)），不改变任何已有方法。

请求 `{}`。响应：

```json
{
  "version": 1,
  "methods": ["device.capabilities", "device.status", "model.sync", "chat.send", "chat.read", "chat.list", "chat.cancel", "document.list", "document.read", "schedule.list"],
  "limits": { "chat.send.max_text_chars": 4000, "file.max_bytes": 104857600 }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | number | 本清单格式的版本，目前为 `1`。桌面遇到更大的版本号时，仍按已知字段读取，忽略不认识的字段 |
| `methods` | string 数组 | 这台手机**实际实现**的全部方法名（含 `device.capabilities` 自己），每项形如 `chat.send`。不在清单里的方法，桌面视为不支持 |
| `limits` | object，可省略 | 可选的数值上限。键名形如 `<方法>.<含义>`，值是**非负整数**；不确定的上限就不要写，不要编造 |

> 这个方法的响应保留**真实的 JSON 类型**（数字、数组、对象），不遵守 §2 第 2 条「字段值几乎全是字符串」的惯例，与 `chat.*`、`document.list/read` 相同。

`limits` 目前定义的键（**不认识的键桌面一律忽略**，后续可能新增）：

| 键 | 含义 |
|---|---|
| `chat.send.max_text_chars` | `chat.send` 一条消息正文允许的最大字符数。桌面在输入框超出时直接提示并阻止发送，不等手机拒绝 |
| `file.max_bytes` | 手机接受的单个文件最大字节数（`file.begin` 的 `size` 上限）。桌面据此在发送大文件前提示 |

行为要求：

- `methods` 必须与手机的**实际分派表**一致（最好由分派表自动生成，而不是另写一份清单），否则桌面会显示手机其实做不了的入口，或藏起做得了的入口。
- 清单里列出的方法，不得再对同样的请求回 `remote.method_unknown`；清单里没有的方法，仍必须按 §1.2 回 `remote.method_unknown`。
- 手机上某项能力需要用户额外授权（例如 `screen.*` 需要用户在手机上打开开关），只要方法**已实现**就应列入 `methods`，授权状态由对应方法回 `screen.permission_required` 表达（见 §8），不要因为开关暂时没开就把方法从清单里拿掉。
- 只读、无副作用，每次返回当前的清单；清单在 App 升级后可能变化，桌面按「设备 ID + 手机 App 版本」缓存，版本变化后重新获取。
- **老手机兼容**：没有实现本方法的手机按 §1.2 回 `remote.method_unknown`。桌面据此把该手机当作「全部支持」，保持现有行为（入口全部显示，调用不支持的方法时按 §1.3 降级）。这不是错误，手机不需要特别处理。
- 错误码：除 `remote.method_unknown` 外，没有本方法专属的错误码。若手机暂时无法回答（例如 `remote.not_ready`），桌面不会把它当作「全部不支持」，而是同样按老手机处理，稍后再试。

桌面据 `methods` 的显示规则（供实现参考，文案可能调整）：

| 功能 | 所需方法 | 手机清单里缺少时 |
|---|---|---|
| 技能 | `skills.*` | 隐藏技能入口 |
| 定时 | `schedule.save` `schedule.toggle` `schedule.delete` `schedule.run` | 编辑入口隐藏；若 `schedule.list` 在清单里，保留只读列表并提示「这台手机的应用暂不支持编辑」 |
| 子代理 | `subagent.*` | 隐藏子代理入口 |
| 文档 | `document.write` | 保留只读（`document.list` / `document.read`），提示「这台手机的应用暂不支持编辑」 |
| 附件、图片 | `chat.file` `chat.image` | 附件按钮置灰，提示「这台手机的应用暂不支持发送附件」 |

此外，桌面运行中如果某个方法回了 `remote.method_unknown`，会把它记入该手机的「不支持」缓存（同样按设备 ID + App 版本），之后按上表处理；这样即使 `device.capabilities` 清单不准确，也不会反复点到失败的功能。

### `device.status`（可选）

请求 `{}`。响应：

| 字段 | 类型 | 说明 |
|---|---|---|
| `battery` | string | 电量百分比 `"0"`–`"100"`；未知为 `""` |
| `network` | string | `wifi` / `cellular` / `ethernet` / `offline` / `unknown` |
| `sampled_at` | string | 采样时间，毫秒时间戳的十进制字符串 |

只读、无副作用，**不要编造数值**。

### `device.rename`（可选）

请求 `{ "name": "…" }`；响应 `{ "name": "<实际保存的名称>" }`。桌面要求回执的 `name` 与请求**逐字相同**，否则判为「手机尚未确认新名称」。所以请原样保存；确实不能接受的名称（例如为空）返回错误，而不是悄悄改写后返回另一个名字。

### `apps.list`（可选）

请求 `{}`。响应（桌面把它原样交给指挥 Agent，字段可按需扩展，但建议保持下面的形状）：

```json
{ "items": [ { "package": "com.example.app", "label": "示例应用" } ], "accessibility": "true", "sampled_at": "1767222000000" }
```

`accessibility` 表示无障碍服务是否已开启（决定指挥 Agent 能否看屏和操作）。只列用户可启动的应用，不读其他应用的数据。

## 7. 文件传输（`file.*`）

所有文件按**发送方桌面**隔离，只有经本通道登记的 `id` 才能访问，**绝不接受任意路径**。桌面限制：单文件 ≤ 100 MiB，分片 128 KiB。手机建议总存储配额 500 MiB（超出 → `file.quota_exceeded`）。

**`FileState`**（多个方法共用的响应）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 传输 ID |
| `name` / `mime` | string | 文件名 / MIME |
| `size` | string | 总字节数（十进制字符串） |
| `sha256` | string | 小写十六进制，64 字符 |
| `offset` | string | **已收到**的字节数（十进制字符串） |
| `status` | string | `uploading`（未收完或未校验）或 `complete`（已校验） |

**上传流程**（桌面 → 手机）：`file.begin` → 循环 `file.chunk`（从手机返回的 `offset` 继续，因此可断点续传）→ `file.finish`。

| 方法 | 请求 | 响应 / 行为 |
|---|---|---|
| `file.begin` | `id`（16–64 个 `[A-Za-z0-9-]`）、`name`（1–200 字符，不含 `/` `\` 与控制字符，不是 `.` `..`）、`mime`（≤ 200）、`size`（字符串，0–104857600）、`sha256`（小写十六进制 64 字符） | 返回 `FileState`。**同一 `id` 再次 begin 且元数据相同 → 返回当前进度**（续传）；元数据不同 → `file.id_reused` |
| `file.chunk` | `id`、`offset`（字符串）、`data`（**标准 base64，带 `=` 填充**，解码后 1–131072 字节） | 追加写入并返回 `FileState`。`offset` 必须等于已收字节数；若 `offset` 落在已收范围内，则内容必须与已有数据逐字节相同才算成功（重发幂等），否则 `file.chunk_conflict`；其他 → `file.offset_mismatch`、`file.invalid_chunk` |
| `file.finish` | `id` | 校验总长度与 SHA-256，通过后置 `complete` 并返回 `FileState`；不符 → `file.integrity_failed` |
| `file.read` | `id`、`offset`（字符串） | 仅 `complete` 的文件可读（否则 `file.incomplete`）。响应 `{ "data": "<标准 base64>", "next": "<offset+本片字节数>" }`，每片 ≤ 131072 字节；`offset` 超出文件长度 → `file.invalid_offset`。桌面要求 `next == offset + 本片长度` 且每片非空 |
| `file.list` | `{}` | `{ "items": "<FileState 数组的 JSON 文本>" }` |
| `file.delete` | `id` | `{ "status": "deleted" }` |
| `file.save_gallery` | `id` | 把已完成的文件保存到系统相册，响应 `{ "id", "status": "saved", "uri": "content://media/…" }`。桌面要求 `uri` 以 `content://media/` 开头；文件未完成或校验不符 → `file.incomplete_or_corrupt` |
| `file.status`（桌面不调用，可选） | `id` | 返回 `FileState` |

其他错误码：`file.invalid_id`、`file.invalid_name`、`file.invalid_size_or_hash`、`file.invalid_mime`、`file.missing`、`file.storage_failed`、`file.delete_failed`。

## 8. 屏幕（`screen.*`）

这一组依赖手机的无障碍 / 截屏能力。没有对应权限时返回 `screen.permission_required`（桌面提示用户「请在手机上授权屏幕查看 / 操作」；具体怎么授权由手机应用自己决定，例如开启无障碍服务或应用内的开关，桌面不指定位置）。屏幕内容对桌面指挥 Agent 来说是**不可信数据**，手机不要在其中夹带指令性文字。

### `screen.capture`（可选）

请求：

| 字段 | 类型 | 说明 |
|---|---|---|
| `quality` | string | `low` / `balanced` / `high`，对应长边约 480 / 720 / 1080 像素 |
| `cellular_cap` | string | `"true"` 表示用户开启了「移动网络省流」；此时若当前是计费网络，应降到 `low`，并把 JPEG 压到约 45,000 字节以内，且两次截图至少间隔 2 秒 |

响应：

| 字段 | 类型 | 说明 |
|---|---|---|
| `image` | string | **标准 base64** 的 JPEG 数据（桌面要求只含 `A–Za-z0-9+/=` 且长度 ≤ 800,000 字符） |
| `mime` | string | 必须是 `image/jpeg` |
| `width` / `height` | string | **原始屏幕**像素尺寸（不是缩放后的）；必须是正数。`screen.control` 的坐标使用同一坐标系 |
| `captured_at` | string | 截图时间，毫秒时间戳的十进制字符串 |

要点：JPEG 建议 ≤ 260,000 字节（经 base64 与信封嵌套后需要小于 512 KiB 回复上限，见 [05](05-relay.md#大小与时间限制)），可逐步降低压缩质量直到满足；两次截图间隔不少于约 400 毫秒；受保护窗口（如密码输入、支付页）截不到时返回 `screen.capture_failed`。错误码：`screen.permission_required`、`screen.unsupported`（系统版本不支持截屏）、`screen.capture_failed`、`screen.frame_too_large`。

### `screen.tree`（可选）

请求 `{}`。响应（桌面原样交给指挥 Agent，建议保持这个形状）：

```json
{ "package": "com.example.app",
  "nodes": [ { "text": "登录", "description": "", "resource": "id/login", "bounds": [0, 0, 100, 50],
               "clickable": true, "editable": false, "focused": false } ],
  "truncated": false }
```

建议：最多 300 个节点、深度最多 20 层，超出时 `truncated: true`；文本截断到 160 字符；**密码输入框的内容必须替换为占位符**（如 `[password]`），不得上报。

### `screen.control`（可选）

代为操作手机。**有副作用，必须严格幂等。**

请求：

| 字段 | 类型 | 说明 |
|---|---|---|
| `request_id` | string | 幂等键，16–64 个 `[A-Za-z0-9-]` |
| `action` | string | `tap` / `swipe` / `type` / `back` / `home` / `open_app`，其他值 → `screen.invalid_action` |
| `x` `y` | string | 点按 / 滑动起点（原始屏幕像素，十进制字符串）；不用时为 `""` |
| `x2` `y2` | string | 滑动终点；不用时为 `""` |
| `text` | string | `type` 要输入的文本，≤ 8000 字符；对当前获得焦点的输入框设置文本 |
| `package_name` | string | `open_app` 的应用包名 |

响应：`{ "status": "completed", "action": "<action>", "at": <毫秒>, "confirmation": "<说明>" }` ——`completed` 的含义是**系统接受了这个动作**，不代表界面效果已达成，桌面指挥 Agent 会再截图 / 读界面树验证。

行为：

1. 校验坐标在屏幕范围内（`screen.invalid_coordinate`）、包名格式与应用存在（`screen.invalid_package` / `screen.app_missing`）；
2. **先写一条「结果未知」的持久收据，再执行**；执行后更新为「已完成」；
3. 同 `request_id` 重发：内容相同且已完成 → 返回原响应；仍是「未知」（上次可能已执行）→ `screen.previous_result_unknown`，**不得再执行**；内容不同 → `screen.id_reused`；
4. 系统没有接受动作 → `screen.action_unconfirmed`；
5. 手机上有 Agent 任务正在运行时，桌面不会下发（避免同时操作），但手机自己也应防御并发。

错误码：`screen.permission_required`、`screen.invalid_request`、`screen.invalid_action`、`screen.invalid_coordinate`、`screen.text_too_long`、`screen.invalid_package`、`screen.app_missing`、`screen.no_window`、`screen.no_focused_input`、`screen.action_unconfirmed`、`screen.receipt_failed`、`screen.id_reused`、`screen.previous_result_unknown`。

## 9. 技能（`skills.*`）

技能是带 `SKILL.md` 的包。桌面安装技能到手机的流程：先用 `file.*` 把 ZIP 包传到手机（拿到传输 `id`），再调 `skills.install`，最后 `file.delete` 清理暂存包。

**`PhoneSkill`**：`id`、`name`、`description`、`version`、`enabled`（`"true"`/`"false"`）、`body`（技能正文，列表中为 `""`），均为 string。

| 方法 | 请求 | 响应 |
|---|---|---|
| `skills.list` | `{}` | `{ "items": "<PhoneSkill 数组的 JSON 文本，body 为空>" }` |
| `skills.read` | `{ "id": …, "enabled": "" }` | `PhoneSkill`（含 `body`） |
| `skills.install` | `{ "id": "<ZIP 的文件传输 id>", "enabled": "" }` | 安装后的 `PhoneSkill` |
| `skills.toggle` | `{ "id": …, "enabled": "true" 或 "false" }` | 更新后的 `PhoneSkill` |
| `skills.delete` | `{ "id": …, "enabled": "" }` | `{ "status": "deleted" }`（删除后要确认确实已删除） |

`skills.install` 必须在写入前严格校验 ZIP：整包 ≤ 10 MiB，且传输已 `complete` 并通过 SHA-256；条目 ≤ 600、实际文件 ≤ 300、展开后总大小 ≤ 30 MiB；根目录（或唯一的公共顶层目录，去掉后）必须有 `SKILL.md`；**拒绝**绝对路径、`..` / `.` 路径段、反斜杠、冒号、NUL 字符、符号链接、重复路径；忽略 `__MACOSX/` 与 `.DS_Store`；写入目录必须落在技能存储根目录之内（规范化路径后比较）。`SKILL.md` 中需能解析出名称、描述、版本、正文，具体格式由手机端的技能体系决定。失败时清理已写入的部分。

错误码：`skill.not_found`、`skill.invalid_toggle`、`skill.invalid_zip`、`skill.unsafe_path`、`skill.duplicate_path`、`skill.package_too_large`、`skill.expanded_too_large`、`skill.too_many_files`、`skill.missing_manifest`、`skill.invalid_manifest`、`skill.invalid_transfer`、`skill.already_exists_or_invalid_name`、`skill.storage_failed`、`skill.delete_failed`。

## 10. 定时任务（`schedule.*`）

手机是定时任务的**权威**，桌面只是它的遥控器；列表同步以手机为准。

**`PhoneSchedule`**（所有字段为 string）：

| 字段 | 说明 |
|---|---|
| `id` | 任务 ID，16–80 个 `[A-Za-z0-9-]`；新建时由桌面生成 |
| `revision` | 版本（不透明字符串），任务内容变化就必须变化 |
| `name` / `prompt` | 名称（≤ 200 字符）/ 到点要执行的提示词（UTF-8 ≤ 60,000 字节） |
| `freq` | `once` / `daily` / `weekly` / `interval`；手机上存在的更复杂触发方式报告为 `custom`（只读） |
| `time` | 本地时间：`"HH:mm"`（24 小时）；`once` 时为 `"yyyy-MM-ddTHH:mm"` |
| `days` | **JSON 文本**的整数数组，`1`=周一 … `7`=周日；`weekly` 必须非空 |
| `every` | `interval` 的间隔，**分钟**，1–525600 |
| `enabled` | `"true"` / `"false"` |
| `session_id` | 空串 = 每次新建会话；否则追加到该会话 |
| `next` / `last` | 下次 / 上次触发的毫秒时间戳；没有则 `""` |
| `runs` | **JSON 文本**的数组，元素 `{ "firedAt": <毫秒数字>, "sessionId": "…", "preview": "…", "ok": true/false }`，最近的运行记录 |
| `editable` | `"true"` 表示桌面可以编辑；含手机端高级配置时报告 `"false"`，写入会被拒绝为 `schedule.edit_on_phone` |

| 方法 | 级别 | 请求 | 响应 |
|---|---|---|---|
| `schedule.list` | 必需（可空） | `{}` | `{ "items": "<PhoneSchedule 数组的 JSON 文本>", "timezone": "<IANA 时区，如 Asia/Shanghai>", "exact": "true" 或 "false" }`。`exact` 表示手机能否精确定时；不支持定时任务时返回 `items: "[]"`、`timezone` 填系统时区、`exact: "false"` |
| `schedule.save` | 可选 | `PhoneSchedule` 里的可写字段：`id` `revision` `name` `prompt` `freq` `time` `days` `every` `enabled` `session_id` | 保存后的 `PhoneSchedule`。新建时 `revision` 为 `""`；修改时必须等于当前版本，否则 `sync.conflict`。`id` 已存在且 `revision` 为 `""`：内容完全相同 → 当作重放，返回已有任务；内容不同 → `schedule.id_reused` |
| `schedule.toggle` | 可选 | `{ "id", "revision", "request_id", "enabled": "<目标状态 true/false>" }` | 更新后的 `PhoneSchedule`；版本不符 `sync.conflict` |
| `schedule.delete` | 可选 | `{ "id", "revision", "request_id", "enabled": "" }` | `{ "status": "deleted" }`；任务已不存在也返回 `deleted`；版本不符 `sync.conflict` |
| `schedule.run` | 可选 | `{ "id", "revision", "request_id", "enabled": "" }`（`revision` 与 `enabled` 在 run 里忽略） | `{ "id": …, "status": "accepted" 或 "dispatching" 或 "failed", "session_id": "…" }` |

`schedule.save` 需要手机已有这台桌面的模型配置（`chat.model_missing` 时桌面会先 `model.sync` 再重试）。`time` 为 `once` 时不得早于现在（除非任务本来就是停用的）：`schedule.time_in_past`。

**`schedule.run` 的语义很严格**，因为一次运行会产生外部副作用：

- 手机先把「`dispatching`」收据**持久化**，再启动任务，再把收据更新为 `accepted`（带上新会话 ID）或 `failed`；
- 同一个 `request_id` 重发 → 直接返回已保存的收据（桌面会在 10 分钟内为未确认的运行复用同一个 `request_id`）；
- 桌面把 `accepted` 视为「已启动」，`failed` / `rejected` 视为「确定没启动」，其余任何状态（含 `dispatching`、网络超时）都视为**结果未知**并保留请求，所以一定要用准确的状态；
- 回复 `status:"error"` 时，只有这些码被桌面视为「确定没执行」：`schedule.invalid_id`、`schedule.invalid_request`、`schedule.missing`、`schedule.id_reused`、`schedule.dispatch_failed`、`sync.conflict`；**其他任何错误码都会被当成结果未知**——如果任务可能已经启动，不要返回上面这几个码。

其他错误码：`schedule.receipt_failed`、`schedule.invalid_content`、`schedule.unsupported_frequency`、`schedule.edit_on_phone`、`schedule.time_in_past`、`schedule.invalid_time`、`schedule.invalid_days`、`schedule.invalid_interval`、`chat.session_missing`、`chat.model_missing`。

## 11. 子代理（`subagent.*`）

子代理是手机 Agent 可以委派的专门角色。手机是权威，桌面草稿不代表写入成功。

**`PhoneSubAgent`**（所有字段为 string）：`id`（`[A-Za-z0-9._-]{1,100}`）、`name`、`description`、`instructions`（工作指令）、`model_group`（空串 = 手机自动选模型；否则必须是 `groups` 里的某个 `id`）、`enabled`（`"true"`/`"false"`）、`builtin`（`"true"`/`"false"`，内置子代理不能删除 / 改名）、`revision`（不透明版本，**覆盖所有语义字段但不含更新时间**，非空）。

四个方法的**响应都是同一个快照 `PhoneSubAgents`**（写操作返回写入后的最新快照）：

```json
{ "items": "<PhoneSubAgent 数组的 JSON 文本>",
  "groups": "<[{\"id\":\"…\",\"name\":\"…\"}] 的 JSON 文本，手机的模型分组>",
  "delegation_enabled": "true" }
```

| 方法 | 请求 | 说明 |
|---|---|---|
| `subagent.list` | `{}` | 返回快照 |
| `subagent.save` | `id` `name` `description` `instructions` `model_group` `enabled` `revision` | 新建（`revision` 为 `""` 且 `id` 不存在）或修改（`revision` 必须等于当前版本，否则 `sync.conflict`）；名称唯一（忽略大小写）；数量有上限 |
| `subagent.toggle` | `id` `enabled`（目标状态）`revision` | 只改启用状态 |
| `subagent.delete` | `id` `enabled`（忽略）`revision` | 删除；内置子代理 → `subagent.builtin` |

桌面会**严格校验**响应：`items` 与 `groups` 必须是合法 JSON 数组，每个子代理的八个字段都是字符串且 `id`、`revision` 非空、`id` 不重复，`enabled`/`builtin`/`delegation_enabled` 只能是 `"true"` 或 `"false"`，否则提示「手机子代理回复格式无效，请更新手机端后重试」。

错误码：`subagent.invalid_id`、`subagent.missing`、`subagent.limit`、`subagent.builtin`、`subagent.invalid_enabled`、`subagent.invalid_definition`、`subagent.model_missing`、`subagent.duplicate_name`、`subagent.not_ready`、`subagent.persist_failed`、`sync.conflict`。

## 12. 协议里存在但手机无需实现的结构

线上协议的 JSON 契约（公开仓库 [`protocol/schema/remote-v1.json`](../../../protocol/schema/remote-v1.json)）里还定义了 `TaskRequest` / `TaskReply`、`CommanderConfig` / `CommanderCall`、`ImageCacheKey` / `ImageCacheWrite`、`ChatSendFiles`、`FileRead` / `FileData` / `FileList` 等结构。其中 `TaskRequest` / `TaskReply`、`CommanderConfig` / `CommanderCall`、`ImageCacheKey` / `ImageCacheWrite` 是早期或桌面本机内部使用的结构，**桌面当前不会通过 RPC 把它们发给手机**，可以忽略；`FileRead` / `FileData` / `FileList` / `ChatSendFiles` 对应本页 `file.read` / `file.list` / `chat.send` 的字段，以本页为准（契约文件里这些结构的字段都是字符串，而 `chat.*` 的真实载荷里有 JSON 数字 / 布尔，这是契约文件没有覆盖的部分，以本页为准）。
