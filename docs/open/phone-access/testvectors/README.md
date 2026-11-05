# 测试向量与自测

两份向量文件 + 一个自测脚本。**先让自己的实现跑通向量，再去联调**——绝大多数互操作问题（编码、拼接、字节序、base64 变体）用向量几分钟就能定位。

| 文件 | 覆盖 | 对应文档 |
|---|---|---|
| [pairing-v1.json](pairing-v1.json) | 公钥串 `K`、指纹、`key_proof`、确认码（SAS）、二维码编码 | [04](../04-identity.md)、[02](../02-qr.md) |
| [remote-envelope-v1.json](remote-envelope-v1.json) | 桌面生成的一个真实加密签名信封（验签、解密） | [06](../06-rpc-envelope.md) |
| [verify.py](verify.py) | 用公开文档中的算法校验以上两份向量的参考脚本 | — |

这两份向量与公开仓库 `protocol/testvectors/` 下的同名文件**内容一致**（那里是协议材料的来源，这里为方便第三方单独取用而复制）。

## 运行参考脚本

```bash
pip install cryptography      # 仅脚本需要
python3 verify.py
# 配对向量：2 组，全部通过
# 信封向量：全部通过
```

脚本中每个函数对应文档里的一个计算步骤，可以直接对照着移植到你的语言。

## `pairing-v1.json`

```jsonc
{
  "version": 1,
  "manual_code_alphabet": "23456789ABCDEFGHJKMNPQRSTUVWXYZ",
  "cases": [ {
    "host": "lom.entermodetwo.com",
    "pairing_id": "…", "claim_token": "…", "psk": "…",
    "desktop": { "x25519": "…", "ed25519": "…", "keys": "…", "fingerprint": "…" },
    "phone":   { "x25519": "…", "ed25519": "…", "keys": "…", "fingerprint": "…" },
    "qr": "lom://pair?v=1&…",
    "key_proof": "…",
    "sas": "643266"
  } ]
}
```

所有二进制值都是无填充 base64url。每组 `cases[i]` 要验证的断言：

1. `keys == b64url(x25519 ‖ ed25519)`，且长度 86（桌面、手机各一）；
2. `fingerprint == b64url(SHA-256("LOM-KEY-FP-V1\n" + keys)[0..16])`（桌面、手机各一）；
3. `qr == "lom://pair?v=1&h=" + b64url(host 的 UTF-8) + "&p=" + pairing_id + "&t=" + claim_token + "&k=" + psk + "&f=" + desktop.fingerprint`；
4. `key_proof == b64url(HMAC-SHA256(unb64(psk), "LOM-PAIR-PROOF-V1\n" + pairing_id + "\n" + desktop.keys + "\n" + phone.keys))`；
5. `sas == 前 4 字节大端取模 1,000,000 的 6 位补零数字`，输入为 `SHA-256("LOM-PAIR-SAS-V1\n" + pairing_id + "\n" + desktop.keys + "\n" + phone.keys)`；
6. 你的二维码解析器必须能从 `qr` 解析出与 `host`、`pairing_id`、`claim_token`、`psk`、`desktop.fingerprint` 相同的值，并拒绝 [02 §3](../02-qr.md#3-手机端校验步骤) 列出的各种非法变体（缺字段、重复字段、`v=2`、带 `=` 填充、字段长度不对）。

向量中的公钥是**任意的 32 字节测试值**，不是从私钥推导的，因此只能用来验证上面这些哈希 / HMAC / 编码计算，不能用来做密钥协商。

## `remote-envelope-v1.json`

```jsonc
{ "envelope": { "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "sender": "…", "recipient": "…",
                "ephemeral": "…", "ciphertext": "…", "signature": "…" },
  "sender": "…", "recipient": "…" }
```

这个信封由桌面实现生成：发送方是「模拟桌面」，接收方是「模拟手机」。两把身份由重复字节的种子生成（**仅限测试，绝不是真实密钥**）：

| 角色 | X25519 私钥 | Ed25519 私钥种子 |
|---|---|---|
| `sender`（模拟桌面） | 32 个 `0x07` | 32 个 `0x08` |
| `recipient`（模拟手机） | 32 个 `0x09` | 32 个 `0x0A` |

验收：

1. 由种子推出的公钥串必须等于文件里的 `sender` / `recipient`；
2. 以接收方身份打开信封（先验签，再解密），明文是 UTF-8 字符串 **`模型同步：test-key`**（中文冒号 `：`）；
3. 篡改 `id`、`ephemeral`、`ciphertext`、`signature` 中的任意一个，打开必须失败；发送方不在信任集合里，必须失败；
4. 以接收方身份对同一个 `id` 封装一个回复（`sender` 为接收方 `K`，`recipient` 为原 `sender`），能被发送方身份打开。

注意：这个向量的明文只是个演示字符串，**不是**合法的 `RpcRequest` JSON，目的只是验证密码学部分。真实请求的明文格式见 [06 §3](../06-rpc-envelope.md#3-内层消息)。如需为自己的 RPC 处理器造测试输入，可以用 `verify.py` 里的 `seal_envelope` 函数加上上面的发送方种子，自己封装 `{"method":"device.status","payload":"{}","issued_at":"<当前毫秒>"}`。
