# 04 身份、密钥与配对算法

本页是全协议的**算法基石**：编码规则、身份密钥、公钥串、指纹、`key_proof`、确认码。所有算法都有测试向量（[testvectors/pairing-v1.json](testvectors/pairing-v1.json)），请先让自己的实现通过向量，再去联调。

## 编码规则

1. **二进制值一律用 base64url（RFC 4648 §5），不带 `=` 填充。** 字母表 `A–Z a–z 0–9 - _`。
2. **解码必须严格**：只接受字母表内字符，且必须是**规范编码**——解码得到字节后再编码，要与原字符串逐字符相同。`AB`（尾部多余的非零位）、`AA==`（带填充）、`a+b/`（标准 base64 字母）都必须拒绝。
3. 公式里的 `pairing_id`、`K电脑`、`K手机` 参与计算的是**它们的文本形式（ASCII 字节）**，不是解码后的字节。`psk` 是例外：作为 HMAC 密钥时使用**解码后的 32 个原始字节**。
4. 公式里的 `\n` 是单个换行字节 `0x0A`，字符串末尾**没有**换行。
5. 所有字符串按 UTF-8 编码后送入哈希 / HMAC（这些输入实际都是 ASCII）。
6. 密钥、指纹等需要「相等」比较的地方，一律**恒定时间比较**。

> 注意：RPC 方法的载荷里还会出现**标准 base64**（带 `+ /` 与 `=` 填充）的字段，比如文件分片 `data`、截图 `image`，那是另一回事，见 [07](07-methods.md)。**信封与配对里的 base64 全部是无填充 base64url。**

## 身份密钥

手机首次启动时生成**一对**长期身份密钥，之后永不更换（更换就等于换了一台设备，需要重新配对）：

| 用途 | 算法 | 原始公钥 | 原始私钥 |
|---|---|---|---|
| 密钥协商（解密桌面发来的信封） | **X25519**（RFC 7748） | 32 字节（u 坐标小端） | 32 字节 |
| 签名（给回复签名） | **Ed25519**（RFC 8032） | 32 字节 | 32 字节种子 |

两个公钥都是**原始 32 字节**，不是 SPKI / DER / PEM 包装。

### 公钥串 `K`

```
K = b64url( x25519_public_key(32 字节) ‖ ed25519_public_key(32 字节) )
```

共 64 字节，base64url 后恰好 **86 个字符**。接口里的 `device_keys`、`desktop_keys`，信封里的 `sender`、`recipient`，都是这个格式的 `K`。

合法性检查（对任何收到的 `K`）：86 个字符、规范 base64url、解码后恰为 64 字节。

### 私钥保护（建议）

- 私钥只存在手机上，**绝不上传、绝不进日志**；云端和桌面都只拿到公钥串 `K`。
- 推荐做法：用 Android Keystore 生成一个不可导出的 **AES-256-GCM** 密钥，用它把两个私钥字节串加密后存入 `noBackupFilesDir`（不参与系统备份）。部分设备 / 系统版本的 Keystore 可以直接保存 Ed25519 / X25519 私钥，但支持不一致，所以包装方案更通用。
- 设备凭据（`device_id` + `device_token`）同样放在 Keystore 保护的存储里。
- 解除配对时清除凭据与所有被批准的桌面公钥；身份密钥对可以保留，也可以删除重建（重建后再配对会被云端视为新设备）。

### 设备身份与账户

- 云端把**同一组公钥 `K`** 视为同一台设备：同一账户重新配对同一组公钥时沿用原 `device_id`，旧凭据作废；
- 同一组公钥不能同时属于两个账户：被另一个账户占用时认领返回 `device.owned_by_other_account`。

## 指纹

```
fingerprint(K) = SHA-256( "LOM-KEY-FP-V1\n" + K )[0..16]      // 取前 16 字节
```

二维码里的 `f` 是 `b64url(fingerprint(K电脑))`。手机用 `inspect` 拿到 `desktop_keys` 后自己算一遍并与 `f` 比较。

## `key_proof`

扫码路径里，手机用 `psk` 证明「我确实扫了这个二维码」：

```
key_proof = b64url( HMAC-SHA256( key = psk(32 字节原始值),
              msg = "LOM-PAIR-PROOF-V1\n" + pairing_id + "\n" + K电脑 + "\n" + K手机 ) )
```

输出 32 字节，base64url 后 43 字符。`K电脑` 是 `inspect` 返回的 `desktop_keys`，`K手机` 是你在 `claim` 里提交的 `device_keys`。桌面用本机的 `psk` 重算并恒定时间比较。

## 确认码（SAS）

配对码路径里没有 `psk`，两端各自计算同一个 6 位数字，由用户肉眼比对：

```
d   = SHA-256( "LOM-PAIR-SAS-V1\n" + pairing_id + "\n" + K电脑 + "\n" + K手机 )
n   = d[0..4] 按大端读成无符号 32 位整数
sas = (n mod 1_000_000) 补零到 6 位十进制
```

展示时可以在中间加空格（如 `482 913`），但比对的是同一个 6 位数。

## 完整算例（测试向量第 1 组）

输入（全部来自 [pairing-v1.json](testvectors/pairing-v1.json) 的 `cases[0]`；这些公钥是任意的 32 字节测试值，不是从私钥推导的）：

```text
pairing_id = OgX7dsvX6Pp6hNZsT6w8Sw
psk        = 3yUTIoVtslOrzFoP_u6Mv94XCSibzlDW7C6unULIp3o        (解码后 32 字节)
K电脑      = 32jqJTBThIbGnEQca3yRNAUe9-fqOW8Rkj1fHjMPej2E1bsA0518osSsj3Rp8dx4MXI6mu0t9VQ30chWisbnbA
K手机      = FukJ5vAdsxAgpk1BpIEm6fz2ExraZY4MBy6QymqDna_CB2bIRp3GlEwfqwxC7UUsu8VyDV84p_TJmQnkPwuWbw
```

输出：

```text
fingerprint(K电脑) = rp1mfT5Bdyg1iFGecQecVQ          // 即二维码 f
fingerprint(K手机) = Ti0hVBou-hZOde-bso7M2Q
key_proof          = AhC3_kPvKz1tG45um27Ovh-jkGhQ8jxCPBCk9lkVqqE
sas                = 643266
```

如果你的实现算不出这几个值，先对照本页的「编码规则」逐条检查（最常见的错误：把 `K` 解码后再参与拼接、把 `psk` 当文本用作 HMAC 密钥、忘记 `\n`、`b64url` 误带填充）。

## 如何自测

```bash
cd testvectors
pip install cryptography
python3 verify.py
```

脚本用与本页完全一致的公式校验两组向量，并演示信封部分的验签与解密，可作为你实现的对照参考，见 [testvectors/README.md](testvectors/README.md)。
