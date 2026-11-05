# 06 RPC 信封：加密、签名、时间窗口与重放保护

桌面和手机之间的每一次请求 / 回复，都是一个**独立的加密 + 签名信封**。云端只转发，看不到内容。本页给出信封格式、精确的加解密与签名步骤，以及手机收到请求后的处理顺序。配套向量：[testvectors/remote-envelope-v1.json](testvectors/remote-envelope-v1.json)。

> 这里**没有** Noise 握手，也没有会话状态：没有「建立通道」「重新握手」这回事。每个信封自带一次性临时密钥，手机收到后凭自己的长期私钥直接解密。

## 1. 一次调用的完整路径

```text
桌面                                云端                              手机
 │ 构造 RpcRequest(JSON)             │                                 │
 │ 加密 + 签名 → 信封 E              │                                 │
 │ POST /v1/devices/{id}/rpc  E  ──▶ │ 校验账户、设备归属、recipient    │
 │                                   │ ── {"type":"task.rpc","envelope":E} ──▶ │
 │                                   │                                 │ 验签、解密、执行
 │                                   │ ◀── {"type":"task.reply","envelope":R} ─│ 加密 + 签名 → 信封 R
 │ ◀── {"success":true,"data":R} ─── │ （最多等 15 秒）                │
 │ 验签、解密 RpcResponse            │                                 │
```

手机只接触右半边：收到 `task.rpc`、发出 `task.reply`（消息格式见 [05 §4](05-relay.md#4-消息格式)）。

## 2. 信封字段

信封是一个 JSON 对象，**恰好**这六个字符串字段（不能多、不能少）：

| 字段 | 内容 | 长度 / 格式 |
|---|---|---|
| `id` | 信封 ID，也是请求 / 回复的配对键 | 32 个十六进制字符（16 字节随机数）；回复信封**沿用请求的 `id`** |
| `sender` | 发送方公钥串 `K` | 86 字符 base64url |
| `recipient` | 接收方公钥串 `K` | 86 字符 base64url |
| `ephemeral` | 发送方为这个信封生成的**一次性 X25519 公钥** | 32 字节 → 43 字符 base64url |
| `ciphertext` | `nonce(12 字节) ‖ 密文 ‖ 认证标签(16 字节)` | base64url，解码后 28 – 400,000 字节 |
| `signature` | 发送方 Ed25519 对 `AAD ‖ ciphertext 原始字节` 的签名 | 64 字节 → 86 字符 base64url |

所有 base64url 都是无填充、规范编码（[04](04-identity.md#编码规则)）。

## 3. 内层消息

信封解密后的明文是 UTF-8 的 JSON 文本。

**请求（桌面 → 手机）`RpcRequest`**：

```json
{ "method": "chat.read", "payload": "{\"session_id\":\"s1\",\"offset\":0}", "issued_at": "1767222000123" }
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `method` | string | 方法名，见 [07](07-methods.md) |
| `payload` | string | **本身是 JSON 文本**（一个 JSON 对象序列化成字符串），不是嵌套对象；无参数时为 `"{}"` |
| `issued_at` | string | 桌面签发时间，**Unix 毫秒的十进制字符串** |

**回复（手机 → 桌面）`RpcResponse`**：

```json
{ "status": "ok", "payload": "{\"items\":[],\"total\":0,\"next\":0,\"running\":false,\"status\":\"idle\",\"error\":\"\"}", "error": "" }
```

```json
{ "status": "error", "payload": "{}", "error": "chat.session_missing" }
```

| 字段 | 说明 |
|---|---|
| `status` | `"ok"` 或 `"error"`，只有这两个值 |
| `payload` | 成功时是方法结果的 JSON 文本（JSON 对象序列化成字符串）；失败时填 `"{}"` |
| `error` | 成功时为 `""`；失败时是错误码（见第 7 节） |

回复请**只包含这三个字段**。解析请求时请对未知字段保持宽容（忽略），以便将来向前兼容。

## 4. 密码学步骤

使用的原语：**X25519**（RFC 7748）、**HKDF-SHA256**（RFC 5869）、**ChaCha20-Poly1305**（RFC 8439，96 位 nonce，16 字节标签）、**Ed25519**（RFC 8032）。

### 4.1 AAD（附加认证数据）

对一个信封，AAD 是下面这个 UTF-8 字符串的字节（`\n` 为单个 `0x0A`，末尾无换行；这四个值取**信封里的原始文本**）：

```
"LOM-REMOTE-V1\n" + id + "\n" + sender + "\n" + recipient + "\n" + ephemeral
```

AAD 把路由信息（谁发给谁、哪个信封）绑进了加密和签名，改动任一字段都会让验签或解密失败。

### 4.2 密钥派生

```
shared = X25519( 发送方的临时私钥, 接收方的 X25519 静态公钥 )      // 发送方视角
shared = X25519( 接收方的 X25519 静态私钥, 信封里的 ephemeral )   // 接收方视角，两者相等
key    = HKDF-SHA256( ikm = shared, salt = 32 个 0x00 字节, info = AAD, L = 32 )
```

- 接收方的 X25519 静态公钥是其公钥串 `K` 解码后的**前 32 字节**；
- 如果 `shared` 是全零（对方给了小阶点），**必须拒绝**（`remote.invalid_key`）；
- `salt` 为 32 个零字节，与 RFC 5869「不提供 salt」的默认值等价。

### 4.3 加密

```
nonce      = 12 个随机字节（每个信封重新生成）
sealed     = ChaCha20-Poly1305-Encrypt( key, nonce, plaintext, aad = AAD )   // 输出 密文 ‖ 16 字节标签
body       = nonce ‖ sealed                                                    // 即信封的 ciphertext 原始字节
ciphertext = b64url( body )
```

明文大小（UTF-8 字节）**不得超过 350,000**；超出时不要发送，返回错误（见第 7 节）。

### 4.4 签名

```
signature = b64url( Ed25519-Sign( 发送方的 Ed25519 私钥, AAD ‖ body ) )
```

签名的输入是 **AAD 字节 与 `body` 原始字节（不是 base64 文本）的直接拼接**。验签用的公钥是发送方公钥串 `K` 解码后的**后 32 字节**。

### 4.5 手机打开收到的信封（验签在解密之前）

```text
1. 检查 envelope.recipient == 自己的 K（逐字符相等）；
2. 检查 envelope.sender ∈ 被批准的桌面公钥集合（逐字符相等）；不在集合内 → 丢弃；
3. 检查 id 长度为 32；sender 解码后 64 字节；ephemeral 解码后 32 字节；
4. body = b64url 解码(ciphertext)；要求 28 ≤ len(body) ≤ 400000；
5. 构造 AAD；用 sender 的后 32 字节作为 Ed25519 公钥，验证 signature 对 (AAD ‖ body)；失败 → 丢弃；
6. shared = X25519(自己的静态私钥, ephemeral)；全零 → 丢弃；
7. key = HKDF(shared, 零 salt, info=AAD)；
8. 用 body[0..12] 作 nonce，body[12..] 作 密文‖标签，AAD 作附加数据，解密；认证失败 → 丢弃；
9. 明文按 UTF-8 解码，再按 JSON 解析为 RpcRequest。
```

### 4.6 手机封装回复

```text
明文 = RpcResponse 的 JSON 文本
信封.id        = 请求信封的 id（原样）
信封.sender    = 手机自己的 K
信封.recipient = 请求信封的 sender（即桌面的 K）
信封.ephemeral = 新生成的一次性 X25519 公钥（每个回复新生成，用完丢弃私钥）
其余按 4.1–4.4 计算；shared = X25519(临时私钥, 桌面K 的前 32 字节)
```

## 5. 手机端处理步骤（含失败时的行为）

收到 `task.rpc` 后**严格按下面的顺序**处理。分界线很重要：**还没能证明请求来自被批准的桌面之前，不要回复任何东西**（回复错误也会泄露信息、被人用来探测）；一旦验签、解密成功，就必须给出回复。

| 步骤 | 检查 | 失败时 |
|---|---|---|
| 1 | 第 4.5 节第 1–9 步：收件人、发送方信任、长度、验签、解密、JSON 解析 | **不回复**（只写不含敏感内容的日志）。桌面 15 秒后得到 `relay.reply_timeout` |
| 2 | 时间窗口：`abs(现在毫秒 − issued_at) ≤ 300000` | 超出窗口回复 `remote.expired`；`issued_at` 缺失或不是十进制整数则回复 `remote.operation_failed` |
| 3 | 配对状态在处理期间没有变化：发送方**仍然**在被批准集合里（防止刚好被解除配对 / 撤销） | 回复错误 `remote.revoked` |
| 4 | 重放检查并**登记**（第 6 节）：键 `sender + ":" + id` 已存在 | 回复错误 `remote.replayed` |
| 5 | 业务模块已就绪 | 回复错误 `remote.not_ready` |
| 6 | 按 `method` 分派；不认识的方法 | 回复错误 `remote.method_unknown` |
| 7 | 执行方法；方法自己的错误 | 回复 `status:"error"` 与方法的错误码（[07](07-methods.md)） |
| 8 | 成功 | 回复 `status:"ok"`，`payload` 为结果 JSON 文本 |

要点：

- 步骤 2–4 的顺序不能换：过期的请求**不应该**被登记进重放表。
- 步骤 4 登记发生在执行**之前**。因此一个已经登记的信封 ID 永远不会被执行第二次——即使第一次执行失败了。桌面每次调用都会生成新的信封 ID，所以重试天然带新 ID；真正需要「同一个操作只做一次」的方法（`chat.send`、`schedule.run`、`screen.control`）另有业务层的幂等键（`client_id` / `request_id`），见 [07](07-methods.md#幂等与结果未知)。
- 方法的任何异常都要被捕获并转成 `status:"error"` 回复；异常取消（协程被取消等）除外。**异常信息只取错误码**，不要把异常文字、路径、堆栈、密钥放进 `error` 字段。

## 6. 时间窗口与重放保护

两层保护：

1. **时间窗口**：`issued_at` 与手机当前时间之差的绝对值必须 ≤ **5 分钟（300,000 毫秒）**。因此手机时钟需要基本准确（建议依赖系统网络时间）；时钟偏差超过 5 分钟时，所有请求都会收到 `remote.expired`。
2. **信封 ID 去重**：登记键 `sender + ":" + id`（文本拼接），保留**至少 10 分钟**（时间窗口前后各 5 分钟，所以一个信封最多有 10 分钟可能被重放），之后可清理。
   - 去重表必须**持久化**（重启后仍然有效），只放内存的话，重启就是一个重放窗口；
   - 查询与登记要对并发安全（两个相同 ID 的请求同时到达，只有一个能通过）。

## 7. 回复里的错误码规则

- `error` 必须匹配 `^[a-z_]+\.[a-z_]+$`（小写字母和下划线，中间恰好一个点），例如 `chat.session_missing`；
- 任何不符合这个格式的内部错误一律用 `remote.operation_failed`；
- 本页定义的协议级错误码：

| 错误码 | 含义 | 桌面表现 |
|---|---|---|
| `remote.expired` | `issued_at` 超出 5 分钟窗口 | 显示错误；通常是双方时钟偏差 |
| `remote.revoked` | 发送方已不被批准 | 提示「手机已撤销此电脑的权限，请重新授权」 |
| `remote.replayed` | 信封 ID 已处理过 | 显示错误 |
| `remote.not_ready` | 手机端服务尚未就绪（例如刚启动） | 提示「手机尚未就绪，请打开手机 App 后重试」 |
| `remote.method_unknown` | 不支持这个方法 | 见 [07 §1](07-methods.md#1-必需与可选不支持时怎么办) |
| `remote.operation_failed` | 其他未分类失败 | 提示「手机操作结果未确认，请刷新状态后重试」 |

另有两个**只会出现在密码学层、不会出现在回复里**的内部错误：`remote.invalid_key`（公钥长度不对、共享密钥全零）和 `remote.payload_invalid`（`ciphertext` 长度不在 28–400,000 字节，或要封装的明文超过 350,000 字节）。前者发生在验签 / 解密阶段，按第 5 节第 1 步「不回复」处理；后者如果发生在封装回复时，手机无法发出回复，桌面只会超时——所以**方法实现必须自己限制返回大小**（分页、缩图）。

## 8. 用向量自测

[remote-envelope-v1.json](testvectors/remote-envelope-v1.json) 是桌面实现生成的一个真实信封：

```json
{ "envelope": { "id": "aaaa…(32 个 a)", "sender": "…", "recipient": "…", "ephemeral": "…", "ciphertext": "…", "signature": "…" },
  "sender": "<同 envelope.sender>", "recipient": "<同 envelope.recipient>" }
```

向量里的两把身份是用**重复字节的种子**造出来的（仅限测试，绝不是真实密钥）：

| 角色 | X25519 私钥 | Ed25519 私钥种子 |
|---|---|---|
| 发送方（模拟桌面） | 32 个 `0x07` | 32 个 `0x08` |
| 接收方（模拟手机） | 32 个 `0x09` | 32 个 `0x0A` |

验收标准：

1. 用接收方的私钥打开向量里的信封，得到明文 **`模型同步：test-key`**（UTF-8，注意是中文冒号）；
2. 把 `id` 改成 32 个 `b`、改动 `ephemeral` / `ciphertext` / `signature` 任意一个字节，打开必须失败；
3. 把 `sender` 从信任集合里拿掉，打开必须失败；
4. 用接收方身份对同一个 `id` 封装一个回复（`sender`=接收方 K，`recipient`=原 `sender`），能被发送方身份打开。

[testvectors/verify.py](testvectors/verify.py) 把上面四条都实现了一遍，可对照。注意：向量里的明文只是个演示字符串，**不是**合法的 `RpcRequest` JSON——它只用来验证密码学部分；真实请求的明文是第 3 节的 JSON。
