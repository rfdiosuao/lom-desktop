# 05 中转连接：设备凭据、令牌、WebSocket、心跳、重连

配对完成后，手机要保持一条到云端的 WebSocket 长连接。连接在线 = 桌面上这台手机显示在线（绿点）；桌面的请求也只能通过这条连接送达手机。

```text
设备凭据 (90 天)  ──POST /v1/relay/token──▶  中转令牌 relay_token (1 小时)
                                                  │
                                      GET wss://<host>/v1/relay
                                      Authorization: Bearer <relay_token>
                                                  ▼
                                   长连接：云端 → 手机 task.rpc / 手机 → 云端 task.reply
```

## 1. 设备凭据

配对 `confirm` 成功后得到 `device_id` 与 `device_token`。需要设备凭据的接口都用请求头：

```
Authorization: Device <device_id>.<device_token>
```

`device_id` 形如 `dev_` + 32 位十六进制，`device_token` 是 43 字符 base64url，二者都不含 `.`，用第一个 `.` 拆开即可。凭据有效期 90 天，**每次换中转令牌时滚动续期**到「现在 + 90 天」，所以只要手机每 90 天内上线一次就不会过期。

凭据失效（被桌面移除、手机自己解除、过期、重新配对导致旧令牌作废）时，所有用到它的接口返回 HTTP 401 `relay.device_revoked`。请求头缺失或格式不对时返回 401 `relay.unauthorized`。

## 2. 换中转令牌

```
POST /v1/relay/token
Authorization: Device <device_id>.<device_token>
Content-Type: application/json

{}
```

成功：

```json
{ "success": true, "data": { "relay_token": "…", "expires_at": 1767225600 } }
```

- `relay_token`：43 字符 base64url 的不透明字符串；`expires_at`：Unix 秒，**固定为现在起 1 小时**。
- 令牌只用于下一步的 WebSocket 握手；不要写进日志，也不要放进 URL。
- 令牌保存在云端内存里：云端重启后旧令牌全部失效，握手会得到 `relay.unauthorized`，此时重新换一个即可。
- **建议每次（重）连接前都新换一个令牌**，不要缓存复用——这个调用很轻，而且顺便为设备凭据续期。

错误：

| HTTP | `code` | 手机应该做什么 |
|---|---|---|
| 401 | `relay.device_revoked` | 凭据已被撤销：走「被撤销」流程（第 6 节），**不再重连** |
| 401 | `relay.unauthorized` | 请求头格式错误：属于实现错误，记录日志；不要无限重试 |
| 网络失败 / 5xx / 非 JSON | — | 进入重连退避（第 5 节） |

## 3. 建立 WebSocket

```
GET wss://<host>/v1/relay
Authorization: Bearer <relay_token>
Upgrade: websocket
```

`<host>` 是配对时保存的云端主机名（官方为 `lom.entermodetwo.com`）。握手前校验失败时，云端返回普通 HTTP 响应（不升级）：

| HTTP | `code` | 含义 |
|---|---|---|
| 401 | `relay.unauthorized` | 令牌无效或已过期（含云端重启）→ 重新换令牌再连 |
| 401 | `relay.device_revoked` | 令牌有效但设备记录已不存在 → 被撤销，走第 6 节 |

握手成功后，云端先发一条欢迎消息，之后进入消息循环。**令牌只在握手时校验一次**：连接建立后令牌过期不会断开连接，也没有「连接内续期」；连接断了再连时，重新换令牌。

同一台手机同一时刻只保留**一条**连接：用同一设备凭据再开一条新连接，云端会关闭旧的（原因 `replaced`）。

## 4. 消息格式

所有业务消息都是 **WebSocket 文本帧**，内容是一个 JSON 对象；二进制帧会被忽略。收到不认识的 `type` 请直接忽略（向前兼容）。

### 云端 → 手机

欢迎（握手成功后立即发送）：

```json
{ "v": 1, "kind": "ctrl", "type": "hello", "device_id": "dev_…", "server_time": 1767222000 }
```

`server_time` 是云端当前的 Unix 秒，可以用来粗略检测手机时钟偏差（RPC 有 5 分钟时间窗口，见 [06](06-rpc-envelope.md#6-时间窗口与重放保护)）。

桌面的 RPC 请求（**注意：这条消息没有 `v` 和 `kind` 字段**，用 `type` 区分）：

```json
{ "type": "task.rpc", "envelope": { "id": "…", "sender": "…", "recipient": "…", "ephemeral": "…", "ciphertext": "…", "signature": "…" } }
```

设备被撤销（随后云端关闭连接）：

```json
{ "v": 1, "kind": "ctrl", "type": "device.revoked" }
```

### 手机 → 云端

对每个 `task.rpc` 回一条 `task.reply`，`envelope` 里是**加密签名后的回复信封**，其 `id` 必须等于请求信封的 `id`：

```json
{ "type": "task.reply", "envelope": { "id": "<与请求相同>", "sender": "…", "recipient": "…", "ephemeral": "…", "ciphertext": "…", "signature": "…" } }
```

规则：

- `envelope` 必须**恰好**含上面六个字符串字段，**不得有多余字段**（云端用严格解析，多余字段会导致回复被丢弃，桌面那边表现为超时）；
- 云端只接受**属于本设备**的请求 ID 的回复；迟到的回复（桌面已经超时放弃）会被丢弃；
- 手机**不需要**发送任何其他应用层消息；在线状态由连接本身表示。

### 大小与时间限制

| 项 | 限制 |
|---|---|
| 桌面 → 手机 的信封 | HTTP 请求体 ≤ 512 KiB（云端已校验），明文 ≤ 350,000 字节 |
| 手机 → 云端 的单条 `task.reply` 文本 | **≤ 512 KiB**；超出会被丢弃（不报错、不通知），桌面 15 秒后超时 |
| 手机回复的明文（JSON 字节数） | **≤ 350,000 字节**（这样加密、base64url 后能保证不超过 512 KiB） |
| 单条 WebSocket 消息上限（云端接收） | 640 KiB；超出会导致连接被关闭 |
| 回复期限 | 云端从转发请求起等 **15 秒**，没收到回复就让桌面以 `relay.reply_timeout`（HTTP 504，「结果未知」）失败。所以每个 RPC 方法都必须在 15 秒内返回——耗时任务要先返回「已接受」，让桌面轮询进度（见 [07](07-methods.md)） |
| 并发 | 同一设备最多 8 个在途请求，超出桌面得到 `relay.busy`（429）；请求可能并发到达，处理器必须线程安全 |

## 5. 心跳与重连

### 心跳

- 云端**每 20 秒**向手机发一个 WebSocket **Ping** 控制帧；
- 云端**60 秒内**没有从手机收到任何帧（包括 Pong、Ping、文本帧），就判定断线并关闭连接；
- 手机端：标准 WebSocket 库会自动回 Pong，这已经足够；**建议同时自己每 20 秒发一次 Ping**（例如 OkHttp 的 `pingInterval(20s)`），这样即使网络半死不活，手机也能比云端更早发现连接已断；
- 读超时不要设得比 60 秒短；长连接上不要设「整次调用超时」。

### 重连退避

连接断开（或握手 / 换令牌失败）后：

| 连续失败次数 | 等待 |
|---|---|
| 第 1 次 | 1 秒 |
| 第 2 次 | 2 秒 |
| 第 3 次 | 5 秒 |
| 第 4 次 | 10 秒 |
| 第 5 次起 | 30 秒（保持） |

每次等待加 **±20% 随机抖动**（`等待 × (1 + 0.2 × 随机数[-1,1])`）。只要有一次连接**成功建立**（握手完成），失败计数清零。

下面这些事件应该**立即重连**，不必等退避结束：系统通知网络可用 / 默认网络切换、屏幕点亮或解锁、App 回到前台。网络丢失时可以主动关闭当前连接，避免半死连接占着。

### 保活（Android）

官方手机端做法供参考：配对期间，用前台服务（常驻通知）+ 上述事件触发重连保持连接；App 进程被系统杀掉后连接就断了，桌面会显示手机离线，**云端不为离线手机排队请求**——桌面此时发 RPC 会立即失败（`relay.offline`，HTTP 409，「手机离线，请打开手机应用」）。云端不依赖任何推送服务，保活策略由你的 App 自己决定。

## 6. 被撤销

触发场景：用户在桌面上移除这台手机、手机自己调用了 `DELETE /v1/devices/me`（此时手机本来就会自己清理）、设备凭据超过 90 天未使用而过期、或手持的是已被新配对替换掉的旧令牌。

手机如何得知：

1. 在线时：收到 `{"v":1,"kind":"ctrl","type":"device.revoked"}`，随后连接被关闭；
2. 离线时：下一次换令牌得到 401 `relay.device_revoked`，或握手得到 401 `relay.device_revoked`。

处理（**不要再重连**）：

1. 删除设备凭据（`device_id`、`device_token`）与所有被批准的桌面公钥；
2. 本地状态回到 `unpaired`，取消正在执行的、来自桌面的任务（可选），关闭 WebSocket；
3. 提示用户「这台手机已解除配对，请重新扫码连接」，并提供重新配对入口；
4. **保留**手机上的会话、技能、人格、记忆等用户数据，不要清空。

> 区分「被撤销」和「断网」：只有明确收到 `device.revoked` 或 `relay.device_revoked` 才清凭据。连接被关闭、超时、5xx、`relay.unauthorized`（握手）都只是重连的理由，不是撤销。

## 7. 手机端的接收循环（伪代码）

```text
on text frame t:
    msg = parse_json(t)  // 解析失败：忽略这一帧
    switch msg.type:
        "hello":        记录 server_time（可选）
        "device.revoked": 执行第 6 节，结束
        "task.rpc":
            if len(t) > 512 KiB: 忽略
            spawn handle_rpc(msg.envelope)      // 不要阻塞读循环；见 06
        default: 忽略

handle_rpc(envelope):
    reply = process_envelope(envelope)          // 验签、解密、执行、加密签名；见 06
    if reply != null:
        ws.send(json({"type": "task.reply", "envelope": reply}))
```

`process_envelope` 在验签 / 信任检查失败时**不回复任何东西**（桌面会 15 秒后超时），在业务失败时回复 `status: "error"` 的加密信封——两者的区别见 [06](06-rpc-envelope.md#5-手机端处理步骤含失败时的行为)。
