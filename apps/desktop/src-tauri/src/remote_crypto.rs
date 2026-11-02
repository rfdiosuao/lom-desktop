//! Signed encrypted envelopes. Only public keys/ciphertext leave the shell.
use crate::{pairing, remote_wire::Envelope};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit,
};
use ed25519_dalek::{Signer, Verifier};
use sha2::Sha256;
fn bytes<const N: usize>(s: &str) -> Result<[u8; N], String> {
    B64.decode(s)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("remote.invalid_key".into())
}
fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut out = [0; N];
    getrandom::fill(&mut out).map_err(|_| "remote.random_failed")?;
    Ok(out)
}
fn aad(e: &Envelope) -> Vec<u8> {
    format!(
        "LOM-REMOTE-V1\n{}\n{}\n{}\n{}",
        e.id, e.sender, e.recipient, e.ephemeral
    )
    .into_bytes()
}
fn cipher(shared: [u8; 32], info: &[u8]) -> Result<ChaCha20Poly1305, String> {
    if shared == [0; 32] {
        return Err("remote.invalid_key".into());
    }
    let mut key = [0; 32];
    hkdf::Hkdf::<Sha256>::new(Some(&[0; 32]), &shared)
        .expand(info, &mut key)
        .map_err(|_| "remote.key_failed")?;
    Ok(ChaCha20Poly1305::new((&key).into()))
}
pub fn seal(
    x_public: &str,
    ed: [u8; 32],
    recipient: String,
    id: String,
    text: &str,
) -> Result<Envelope, String> {
    if text.len() > 350_000 || id.len() != 32 {
        return Err("remote.payload_invalid".into());
    }
    let target = bytes::<64>(&recipient)?;
    let peer = x25519_dalek::PublicKey::from(
        <[u8; 32]>::try_from(&target[..32]).map_err(|_| "remote.invalid_key")?,
    );
    let eph = x25519_dalek::StaticSecret::from(random::<32>()?);
    let mut e = Envelope {
        id,
        sender: x_public.into(),
        recipient,
        ephemeral: B64.encode(x25519_dalek::PublicKey::from(&eph).as_bytes()),
        ciphertext: String::new(),
        signature: String::new(),
    };
    let a = aad(&e);
    let nonce = random::<12>()?;
    let ct = cipher(eph.diffie_hellman(&peer).to_bytes(), &a)?
        .encrypt(
            (&nonce).into(),
            Payload {
                msg: text.as_bytes(),
                aad: &a,
            },
        )
        .map_err(|_| "remote.encrypt_failed")?;
    let body = [nonce.to_vec(), ct].concat();
    e.signature = B64.encode(
        ed25519_dalek::SigningKey::from_bytes(&ed)
            .sign(&[a, body.clone()].concat())
            .to_bytes(),
    );
    e.ciphertext = B64.encode(body);
    Ok(e)
}
pub fn open(x: [u8; 32], own: &str, sender: &str, e: &Envelope) -> Result<String, String> {
    if e.recipient != own || e.sender != sender {
        return Err("remote.untrusted_peer".into());
    }
    let keys = bytes::<64>(sender)?;
    let a = aad(e);
    let body = B64
        .decode(&e.ciphertext)
        .map_err(|_| "remote.invalid_payload")?;
    if body.len() < 28 || body.len() > 400_000 {
        return Err("remote.invalid_payload".into());
    }
    let vk = ed25519_dalek::VerifyingKey::from_bytes(
        &<[u8; 32]>::try_from(&keys[32..]).map_err(|_| "remote.invalid_key")?,
    )
    .map_err(|_| "remote.invalid_key")?;
    vk.verify(
        &[a.clone(), body.clone()].concat(),
        &ed25519_dalek::Signature::from_bytes(&bytes::<64>(&e.signature)?),
    )
    .map_err(|_| "remote.invalid_signature")?;
    let eph = x25519_dalek::PublicKey::from(bytes::<32>(&e.ephemeral)?);
    let shared = x25519_dalek::StaticSecret::from(x)
        .diffie_hellman(&eph)
        .to_bytes();
    let plain = cipher(shared, &a)?
        .decrypt(
            (&body[..12]).into(),
            Payload {
                msg: &body[12..],
                aad: &a,
            },
        )
        .map_err(|_| "remote.decrypt_failed")?;
    String::from_utf8(plain).map_err(|_| "remote.invalid_text".into())
}
fn pinned(device_id: &str) -> Result<String, String> {
    keyring::Entry::new(
        "org.lom.community.desktop",
        &format!("paired-device:{device_id}"),
    )
    .map_err(|_| "remote.trust_store")?
    .get_password()
    .map_err(|_| "remote.repair_required".into())
}
#[tauri::command]
pub fn remote_pin(device_id: String, keys: String) -> Result<(), String> {
    bytes::<64>(&keys)?;
    if !device_id.starts_with("dev_") || device_id.len() > 80 {
        return Err("remote.invalid_device".into());
    }
    keyring::Entry::new(
        "org.lom.community.desktop",
        &format!("paired-device:{device_id}"),
    )
    .map_err(|_| "remote.trust_store")?
    .set_password(&keys)
    .map_err(|_| "remote.trust_store".into())
}
#[tauri::command]
pub fn remote_seal(device_id: String, id: String, text: String) -> Result<Envelope, String> {
    let s = pairing::stored()?;
    seal(
        &pairing::public_keys(&s)?,
        bytes(&s.ed25519)?,
        pinned(&device_id)?,
        id,
        &text,
    )
}
#[tauri::command]
pub fn remote_open(device_id: String, envelope: Envelope) -> Result<String, String> {
    let s = pairing::stored()?;
    open(
        bytes(&s.x25519)?,
        &pairing::public_keys(&s)?,
        &pinned(&device_id)?,
        &envelope,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn keys(x: [u8; 32], e: [u8; 32]) -> String {
        pairing::keys_of(
            x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(x)).as_bytes(),
            ed25519_dalek::SigningKey::from_bytes(&e)
                .verifying_key()
                .as_bytes(),
        )
    }
    #[test]
    fn r02_signed_envelope_roundtrip_tamper_and_peer_isolation() {
        let a = keys([7; 32], [8; 32]);
        let b = keys([9; 32], [10; 32]);
        let envelope = seal(&a, [8; 32], b.clone(), "a".repeat(32), "模型同步：test-key").unwrap();
        assert_eq!(
            open([9; 32], &b, &a, &envelope).unwrap(),
            "模型同步：test-key"
        );
        assert!(open([9; 32], &b, &b, &envelope).is_err());
        let mut corrupt = envelope.clone();
        corrupt.id = "b".repeat(32);
        assert!(open([9; 32], &b, &a, &corrupt).is_err());
        let mut corrupt = envelope.clone();
        let replacement = if &corrupt.ciphertext[4..5] == "A" {
            "B"
        } else {
            "A"
        };
        corrupt.ciphertext.replace_range(4..5, replacement);
        assert!(open([9; 32], &b, &a, &corrupt).is_err());
        if let Ok(path) = std::env::var("LOM_VECTOR_OUT") {
            std::fs::write(
                path,
                serde_json::to_string(
                    &serde_json::json!({"sender":a,"recipient":b,"envelope":envelope}),
                )
                .unwrap(),
            )
            .unwrap();
        }
        if let Ok(path) = std::env::var("LOM_VECTOR_REVERSE") {
            let reply: Envelope =
                serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
            assert_eq!(open([7; 32], &a, &b, &reply).unwrap(), "手机回复：ok");
        }
    }
}
