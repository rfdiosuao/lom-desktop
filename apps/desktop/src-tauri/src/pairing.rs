//! R01 电脑一侧：安装身份（X25519 + Ed25519，私钥只存系统钥匙串）、二维码、key_proof 核对、确认码。
//! psk 只在本进程内存里生成和使用，不经过前端以外的任何地方，也从不发给云端；
//! 前端拿到的是二维码图像和核对结果。计算规则见 specs/relay/R01-pairing.md §2.8。

use std::collections::HashMap;
use std::sync::Mutex;

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const KEYCHAIN_SERVICE: &str = "org.lom.community.desktop";
const KEYCHAIN_ACCOUNT: &str = "install-identity";

/// pairing_id → psk；同一时刻只保留当前这一个配对会话
static PSKS: Mutex<Option<HashMap<String, [u8; 32]>>> = Mutex::new(None);

#[derive(Serialize, Deserialize)]
pub(crate) struct Stored {
    install_id: String,
    pub(crate) x25519: String,
    pub(crate) ed25519: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    install_id: String,
    keys: String,
    name: String,
}

fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).map_err(|e| format!("pairing.random_failed: {e}"))?;
    Ok(b)
}

fn decode<const N: usize>(s: &str) -> Option<[u8; N]> {
    B64.decode(s).ok()?.try_into().ok()
}

/// 公钥串 K = b64url(x25519 公钥 ‖ ed25519 公钥)
pub fn keys_of(x25519_pub: &[u8; 32], ed25519_pub: &[u8; 32]) -> String {
    let mut k = Vec::with_capacity(64);
    k.extend_from_slice(x25519_pub);
    k.extend_from_slice(ed25519_pub);
    B64.encode(k)
}

pub fn fingerprint(keys: &str) -> [u8; 16] {
    let d = Sha256::digest(format!("LOM-KEY-FP-V1\n{keys}").as_bytes());
    let mut f = [0u8; 16];
    f.copy_from_slice(&d[..16]);
    f
}

fn proof_mac(
    psk: &[u8; 32],
    pairing_id: &str,
    desktop: &str,
    phone: &str,
) -> Result<Hmac<Sha256>, String> {
    let mut m = Hmac::<Sha256>::new_from_slice(psk).map_err(|e| format!("pairing.hmac: {e}"))?;
    m.update(format!("LOM-PAIR-PROOF-V1\n{pairing_id}\n{desktop}\n{phone}").as_bytes());
    Ok(m)
}

/// 手机一侧的计算；电脑只做核对（见 pairing_check_proof），这里用于对照测试向量
#[cfg(test)]
pub fn key_proof(
    psk: &[u8; 32],
    pairing_id: &str,
    desktop: &str,
    phone: &str,
) -> Result<String, String> {
    Ok(B64.encode(
        proof_mac(psk, pairing_id, desktop, phone)?
            .finalize()
            .into_bytes(),
    ))
}

pub fn sas(pairing_id: &str, desktop: &str, phone: &str) -> String {
    let d = Sha256::digest(format!("LOM-PAIR-SAS-V1\n{pairing_id}\n{desktop}\n{phone}").as_bytes());
    let n = u32::from_be_bytes([d[0], d[1], d[2], d[3]]) % 1_000_000;
    format!("{n:06}")
}

pub fn qr_text(
    host: &str,
    pairing_id: &str,
    claim_token: &str,
    psk: &[u8; 32],
    fp: &[u8; 16],
) -> String {
    format!(
        "lom://pair?v=1&h={}&p={pairing_id}&t={claim_token}&k={}&f={}",
        B64.encode(host.as_bytes()),
        B64.encode(psk),
        B64.encode(fp)
    )
}

pub fn qr_svg(text: &str) -> Result<String, String> {
    let code = qrcode::QrCode::with_error_correction_level(text.as_bytes(), qrcode::EcLevel::M)
        .map_err(|e| format!("pairing.qr: {e}"))?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .quiet_zone(false)
        .min_dimensions(240, 240)
        .build())
}

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
        .map_err(|e| format!("pairing.keychain: {e}"))
}

/// 读取或首次生成这台电脑的安装身份
pub(crate) fn stored() -> Result<Stored, String> {
    let entry = keychain()?;
    match entry.get_password() {
        Ok(json) => {
            serde_json::from_str(&json).map_err(|e| format!("pairing.identity_corrupt: {e}"))
        }
        Err(keyring::Error::NoEntry) => {
            let s = Stored {
                install_id: format!("inst_{}", hex(&random::<12>()?)),
                x25519: B64.encode(random::<32>()?),
                ed25519: B64.encode(random::<32>()?),
            };
            let json = serde_json::to_string(&s).map_err(|e| format!("pairing.identity: {e}"))?;
            entry
                .set_password(&json)
                .map_err(|e| format!("pairing.keychain: {e}"))?;
            Ok(s)
        }
        Err(e) => Err(format!("pairing.keychain: {e}")),
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub(crate) fn public_keys(s: &Stored) -> Result<String, String> {
    let x: [u8; 32] = decode(&s.x25519).ok_or("pairing.identity_corrupt")?;
    let e: [u8; 32] = decode(&s.ed25519).ok_or("pairing.identity_corrupt")?;
    let xp = x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(x));
    let ep = ed25519_dalek::SigningKey::from_bytes(&e).verifying_key();
    Ok(keys_of(xp.as_bytes(), ep.as_bytes()))
}

#[tauri::command]
pub fn pairing_identity() -> Result<Identity, String> {
    let s = stored()?;
    let name = whoami::fallible::devicename().unwrap_or_else(|_| "这台电脑".into());
    Ok(Identity {
        keys: public_keys(&s)?,
        install_id: s.install_id,
        name,
    })
}

/// 为新会话生成 psk（只留在内存）并返回二维码 SVG
#[tauri::command]
pub fn pairing_qr(host: String, pairing_id: String, claim_token: String) -> Result<String, String> {
    let host_ok = !host.is_empty()
        && host.len() <= 253
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-');
    if !host_ok || decode::<16>(&pairing_id).is_none() || decode::<32>(&claim_token).is_none() {
        return Err("pairing.session_invalid".into());
    }
    let psk = random::<32>()?;
    let fp = fingerprint(&public_keys(&stored()?)?);
    let text = qr_text(&host, &pairing_id, &claim_token, &psk, &fp);
    let svg = qr_svg(&text)?;
    let mut map = PSKS.lock().map_err(|_| "pairing.state_poisoned")?;
    *map = Some(HashMap::from([(pairing_id, psk)]));
    Ok(svg)
}

/// 扫码路径：用 psk 核对手机上报的 key_proof（恒定时间比较）
#[tauri::command]
pub fn pairing_check_proof(
    pairing_id: String,
    device_keys: String,
    key_proof: String,
) -> Result<bool, String> {
    let psk = PSKS
        .lock()
        .map_err(|_| "pairing.state_poisoned")?
        .as_ref()
        .and_then(|m| m.get(&pairing_id).copied())
        .ok_or("pairing.psk_missing")?;
    let Ok(proof) = B64.decode(&key_proof) else {
        return Ok(false);
    };
    let desktop = public_keys(&stored()?)?;
    Ok(proof_mac(&psk, &pairing_id, &desktop, &device_keys)?
        .verify_slice(&proof)
        .is_ok())
}

/// 配对码路径：根据两端公钥在本机计算确认码
#[tauri::command]
pub fn pairing_sas(pairing_id: String, device_keys: String) -> Result<String, String> {
    Ok(sas(&pairing_id, &public_keys(&stored()?)?, &device_keys))
}

/// 弹窗关闭或刷新时丢弃 psk
#[tauri::command]
pub fn pairing_forget() -> Result<(), String> {
    *PSKS.lock().map_err(|_| "pairing.state_poisoned")? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn r01_matches_shared_vectors() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../testdata/pairing-v1.json")).unwrap();
        for c in v["cases"].as_array().unwrap() {
            let s = |p: &str| c.pointer(p).and_then(|x| x.as_str()).unwrap().to_owned();
            let kd = keys_of(
                &decode(&s("/desktop/x25519")).unwrap(),
                &decode(&s("/desktop/ed25519")).unwrap(),
            );
            let kp = keys_of(
                &decode(&s("/phone/x25519")).unwrap(),
                &decode(&s("/phone/ed25519")).unwrap(),
            );
            assert_eq!(kd, s("/desktop/keys"));
            let fp = fingerprint(&kd);
            assert_eq!(B64.encode(fp), s("/desktop/fingerprint"));
            let psk: [u8; 32] = decode(&s("/psk")).unwrap();
            let pid = s("/pairing_id");
            assert_eq!(key_proof(&psk, &pid, &kd, &kp).unwrap(), s("/key_proof"));
            assert_eq!(sas(&pid, &kd, &kp), s("/sas"));
            assert_eq!(
                qr_text(&s("/host"), &pid, &s("/claim_token"), &psk, &fp),
                s("/qr")
            );
        }
    }
}
