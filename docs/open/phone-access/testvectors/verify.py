#!/usr/bin/env python3
"""按《麓鸣手机接入协议》文档自测：用两份测试向量校验算法实现。

依赖：Python 3.9+、`pip install cryptography`。
运行：python3 verify.py            （在本目录下）
退出码 0 表示全部通过；任何一项不一致都会打印原因并以非 0 退出。

这份脚本只依据公开文档（../04-identity.md、../06-rpc-envelope.md）写成，
可以直接当作第三方实现的参考：每个函数都对应文档里的一个计算步骤。
"""
import base64
import hashlib
import hmac
import json
import os
import sys

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = serialization.Encoding.Raw, serialization.PublicFormat.Raw


# ---------- 编码：base64url，不带填充，且必须是规范编码 ----------
def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64(text: str) -> bytes:
    if not text or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" for c in text):
        raise ValueError("非 base64url 字符（不接受填充 = 或 +/）")
    data = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    if b64(data) != text:
        raise ValueError("非规范 base64url 编码")
    return data


# ---------- 配对：公钥串、指纹、key_proof、确认码、二维码 ----------
def keys_of(x25519_pub: bytes, ed25519_pub: bytes) -> str:
    assert len(x25519_pub) == 32 and len(ed25519_pub) == 32
    return b64(x25519_pub + ed25519_pub)


def fingerprint(keys: str) -> bytes:
    return hashlib.sha256(("LOM-KEY-FP-V1\n" + keys).encode()).digest()[:16]


def key_proof(psk: bytes, pairing_id: str, desktop_keys: str, phone_keys: str) -> str:
    msg = f"LOM-PAIR-PROOF-V1\n{pairing_id}\n{desktop_keys}\n{phone_keys}".encode()
    return b64(hmac.new(psk, msg, hashlib.sha256).digest())


def sas(pairing_id: str, desktop_keys: str, phone_keys: str) -> str:
    d = hashlib.sha256(f"LOM-PAIR-SAS-V1\n{pairing_id}\n{desktop_keys}\n{phone_keys}".encode()).digest()
    return f"{int.from_bytes(d[:4], 'big') % 1_000_000:06d}"


def qr_text(host: str, pairing_id: str, claim_token: str, psk: bytes, fp: bytes) -> str:
    return (f"lom://pair?v=1&h={b64(host.encode())}&p={pairing_id}"
            f"&t={claim_token}&k={b64(psk)}&f={b64(fp)}")


def check_pairing(path: str) -> int:
    vec = json.load(open(path, encoding="utf-8"))
    failures = 0
    for i, c in enumerate(vec["cases"]):
        def eq(name, got, want):
            nonlocal failures
            if got != want:
                failures += 1
                print(f"  ✗ case {i} {name}\n      得到 {got}\n      期望 {want}")
        kd = keys_of(unb64(c["desktop"]["x25519"]), unb64(c["desktop"]["ed25519"]))
        kp = keys_of(unb64(c["phone"]["x25519"]), unb64(c["phone"]["ed25519"]))
        eq("desktop.keys", kd, c["desktop"]["keys"])
        eq("phone.keys", kp, c["phone"]["keys"])
        eq("desktop.keys 长度", len(kd), 86)
        eq("desktop.fingerprint", b64(fingerprint(kd)), c["desktop"]["fingerprint"])
        eq("phone.fingerprint", b64(fingerprint(kp)), c["phone"]["fingerprint"])
        psk = unb64(c["psk"])
        eq("key_proof", key_proof(psk, c["pairing_id"], kd, kp), c["key_proof"])
        eq("sas", sas(c["pairing_id"], kd, kp), c["sas"])
        eq("qr", qr_text(c["host"], c["pairing_id"], c["claim_token"], psk, fingerprint(kd)), c["qr"])
        # 篡改电脑公钥必须让 key_proof / 指纹都对不上
        bad = keys_of(bytes(32), unb64(c["desktop"]["ed25519"]))
        eq("篡改后 key_proof 不同", key_proof(psk, c["pairing_id"], bad, kp) != c["key_proof"], True)
        eq("篡改后指纹不同", b64(fingerprint(bad)) != c["desktop"]["fingerprint"], True)
    print(f"配对向量：{len(vec['cases'])} 组，{'全部通过' if not failures else f'{failures} 项失败'}")
    return failures


# ---------- RPC 信封：X25519 → HKDF-SHA256 → ChaCha20-Poly1305，Ed25519 签名 ----------
def aad_of(env: dict) -> bytes:
    return "\n".join(["LOM-REMOTE-V1", env["id"], env["sender"], env["recipient"], env["ephemeral"]]).encode()


def derive(shared: bytes, aad: bytes) -> ChaCha20Poly1305:
    if shared == bytes(32):
        raise ValueError("remote.invalid_key：共享密钥全零")
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=bytes(32), info=aad).derive(shared)
    return ChaCha20Poly1305(key)


def open_envelope(env: dict, my_x25519_secret: bytes, my_keys: str, trusted_senders: set) -> str:
    if env["recipient"] != my_keys or env["sender"] not in trusted_senders or len(env["id"]) != 32:
        raise ValueError("remote.untrusted_peer")
    sender = unb64(env["sender"])
    if len(sender) != 64:
        raise ValueError("remote.invalid_key")
    aad = aad_of(env)
    body = unb64(env["ciphertext"])
    if not 28 <= len(body) <= 400_000:
        raise ValueError("remote.payload_invalid")
    # 先验签，再解密
    Ed25519PublicKey.from_public_bytes(sender[32:]).verify(unb64(env["signature"]), aad + body)
    eph = unb64(env["ephemeral"])
    if len(eph) != 32:
        raise ValueError("remote.invalid_key")
    shared = X25519PrivateKey.from_private_bytes(my_x25519_secret).exchange(X25519PublicKey.from_public_bytes(eph))
    return derive(shared, aad).decrypt(body[:12], body[12:], aad).decode("utf-8")


def seal_envelope(text: str, env_id: str, my_keys: str, my_ed25519_seed: bytes, recipient: str) -> dict:
    data = text.encode("utf-8")
    if len(data) > 350_000 or len(env_id) != 32:
        raise ValueError("remote.payload_invalid")
    peer = unb64(recipient)
    if len(peer) != 64:
        raise ValueError("remote.invalid_key")
    eph = X25519PrivateKey.generate()
    env = {"id": env_id, "sender": my_keys, "recipient": recipient,
           "ephemeral": b64(eph.public_key().public_bytes(*RAW)), "ciphertext": "", "signature": ""}
    aad = aad_of(env)
    shared = eph.exchange(X25519PublicKey.from_public_bytes(peer[:32]))
    nonce = os.urandom(12)
    body = nonce + derive(shared, aad).encrypt(nonce, data, aad)
    env["signature"] = b64(Ed25519PrivateKey.from_private_bytes(my_ed25519_seed).sign(aad + body))
    env["ciphertext"] = b64(body)
    return env


def keys_from_seeds(x_seed: bytes, ed_seed: bytes) -> str:
    return keys_of(X25519PrivateKey.from_private_bytes(x_seed).public_key().public_bytes(*RAW),
                   Ed25519PrivateKey.from_private_bytes(ed_seed).public_key().public_bytes(*RAW))


def check_envelope(path: str) -> int:
    vec = json.load(open(path, encoding="utf-8"))
    env = vec["envelope"]
    failures = 0

    def ok(name, cond):
        nonlocal failures
        if not cond:
            failures += 1
            print(f"  ✗ {name}")

    # 向量里的两把身份由重复字节的种子生成（仅限测试，绝不是真实密钥）：
    #   发送方（模拟桌面）X25519=0x07×32，Ed25519 种子=0x08×32
    #   接收方（模拟手机）X25519=0x09×32，Ed25519 种子=0x0A×32
    desktop_x, desktop_ed = bytes([7]) * 32, bytes([8]) * 32
    phone_x, phone_ed = bytes([9]) * 32, bytes([10]) * 32
    desktop_keys = keys_from_seeds(desktop_x, desktop_ed)
    phone_keys = keys_from_seeds(phone_x, phone_ed)
    ok("向量 sender 等于 0x07/0x08 种子对应的公钥串", desktop_keys == vec["sender"] == env["sender"])
    ok("向量 recipient 等于 0x09/0x0A 种子对应的公钥串", phone_keys == vec["recipient"] == env["recipient"])

    plain = open_envelope(env, phone_x, phone_keys, {desktop_keys})
    ok(f"解密得到预期明文（得到 {plain!r}）", plain == "模型同步：test-key")

    for name, mutate in [
        ("改 id 必须失败", lambda e: {**e, "id": "b" * 32}),
        ("改 ephemeral 必须失败", lambda e: {**e, "ephemeral": b64(bytes(31) + b"\x01")}),
        ("改 ciphertext 必须失败", lambda e: {**e, "ciphertext": b64(bytes([unb64(e["ciphertext"])[0] ^ 1]) + unb64(e["ciphertext"])[1:])}),
        ("改 signature 必须失败", lambda e: {**e, "signature": b64(bytes([unb64(e["signature"])[0] ^ 1]) + unb64(e["signature"])[1:])}),
    ]:
        try:
            open_envelope(mutate(env), phone_x, phone_keys, {desktop_keys})
            ok(name, False)
        except Exception:
            pass
    try:
        open_envelope(env, phone_x, phone_keys, set())
        ok("不在信任列表的发送方必须被拒绝", False)
    except ValueError as e:
        ok("不在信任列表的发送方必须被拒绝", str(e) == "remote.untrusted_peer")

    # 手机回复：用手机身份封装，再用桌面身份打开
    reply = seal_envelope('{"status":"ok","payload":"{}","error":""}', env["id"], phone_keys, phone_ed, desktop_keys)
    ok("回复使用同一个 id", reply["id"] == env["id"])
    ok("回复 sender/recipient 与请求相反", reply["sender"] == phone_keys and reply["recipient"] == desktop_keys)
    ok("回复可被桌面身份打开",
       open_envelope(reply, desktop_x, desktop_keys, {phone_keys}) == '{"status":"ok","payload":"{}","error":""}')

    print(f"信封向量：{'全部通过' if not failures else f'{failures} 项失败'}")
    return failures


if __name__ == "__main__":
    total = check_pairing(os.path.join(HERE, "pairing-v1.json")) + check_envelope(os.path.join(HERE, "remote-envelope-v1.json"))
    sys.exit(1 if total else 0)
