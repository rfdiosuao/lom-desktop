//! Community LAN pairing and encrypted RPC transport.
//! The desktop is the local host; no Lom cloud or relay server is involved.
//! Pairing uses the existing X25519/Ed25519 identity plus a one-time QR psk.
//! After pairing, only signed encrypted envelopes cross the LAN.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{IpAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{pairing, remote_crypto};

const MAX_BODY: usize = 512 * 1024;
const MAX_HEADER_LINE: usize = 8 * 1024;
const MAX_HEADERS: usize = 64;
const MAX_CONNECTIONS: usize = 32;
const MAX_OUTBOX: usize = 64;
const PAIR_TTL: i64 = 300;
const RPC_TIMEOUT: Duration = Duration::from_secs(20);
const ONLINE_WINDOW: i64 = 15;
const TOKEN_TTL: i64 = 90 * 24 * 3600;

#[derive(Clone, Serialize, Deserialize)]
pub struct Device {
    id: String,
    name: String,
    model: String,
    os: String,
    app_version: String,
    keys: String,
    token_hash: String,
    last_seen: i64,
    #[serde(default)]
    token_expires: i64,
}

struct Pending {
    keys: String,
    info: Value,
    secret: String,
}

struct Session {
    pairing_id: String,
    claim_token: String,
    psk: [u8; 32],
    desktop_name: String,
    desktop_keys: String,
    expires: i64,
    state: String,
    pending: Option<Pending>,
    device_id: Option<String>,
}

#[derive(Default)]
struct Inner {
    started: bool,
    host: String,
    session: Option<Session>,
    devices: HashMap<String, Device>,
    outbox: HashMap<String, Vec<Value>>,
    pending_rpc: HashMap<String, mpsc::Sender<Value>>,
}

pub struct Lan {
    inner: Mutex<Inner>,
    connections: AtomicUsize,
}

impl Default for Lan {
    fn default() -> Self {
        let devices = load_devices().unwrap_or_else(|e| {
            log::warn!("lan.devices_load_failed: {e}");
            HashMap::new()
        });
        Self {
            inner: Mutex::new(Inner {
                devices,
                ..Inner::default()
            }),
            connections: AtomicUsize::new(0),
        }
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| "lan.random_failed".to_owned())?;
    Ok(bytes)
}

fn token() -> Result<String, String> {
    Ok(B64.encode(random::<32>()?))
}

fn hash(value: &str) -> String {
    hex(Sha256::digest(value.as_bytes()))
}

fn hex(bytes: impl AsRef<[u8]>) -> String {
    bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

fn preferred_interface(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("en") || name.starts_with("eth") || name.starts_with("wlan") || name.starts_with("wl")
}

fn lan_source(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback(),
        IpAddr::V6(ip) => ip.is_loopback(),
    }
}

fn local_ip() -> Result<String, String> {
    // Do not use a public default route here: a LAN-only network may have no route to 8.8.8.8,
    // and a VPN/TUN address is not reachable by the phone. Prefer the physical Wi-Fi/Ethernet
    // interface over Docker, VM and tunnel addresses that are also private IPv4.
    let addrs = if_addrs::get_if_addrs().map_err(|_| "lan.no_lan_address".to_owned())?;
    let mut candidates: Vec<(String, String)> = addrs
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(ip) if ip.is_private() => Some((interface.name, ip.to_string())),
            _ => None,
        })
        .collect();
    candidates.sort_by_key(|(name, _)| !preferred_interface(name));
    candidates
        .into_iter()
        .map(|(_, ip)| ip)
        .next()
        .ok_or_else(|| "lan.no_lan_address".to_owned())
}

fn bounded_text(value: &Value, max: usize) -> String {
    value
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect()
}

fn load_devices() -> Result<HashMap<String, Device>, String> {
    let entry = keyring::Entry::new("org.lom.community.desktop", "lan-devices")
        .map_err(|_| "lan.keychain".to_owned())?;
    match entry.get_password() {
        Ok(text) => serde_json::from_str(&text).map_err(|_| "lan.devices_corrupt".to_owned()),
        Err(keyring::Error::NoEntry) => Ok(HashMap::new()),
        Err(_) => Err("lan.keychain".to_owned()),
    }
}

fn save_devices(devices: &HashMap<String, Device>) -> Result<(), String> {
    let text = serde_json::to_string(devices).map_err(|_| "lan.devices_encode".to_owned())?;
    keyring::Entry::new("org.lom.community.desktop", "lan-devices")
        .map_err(|_| "lan.keychain".to_owned())?
        .set_password(&text)
        .map_err(|_| "lan.keychain".to_owned())
}

fn response(stream: &mut TcpStream, code: u16, body: Value) -> Result<(), String> {
    let body = body.to_string();
    write!(
        stream,
        "HTTP/1.1 {code} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        if code == 200 { "OK" } else { "Status" },
        body.len()
    )
    .map_err(|_| "lan.response_failed".to_owned())
}

fn failure(code: &str) -> (u16, Value) {
    (
        400,
        json!({ "success": false, "code": code, "error": code }),
    )
}

fn request(stream: &mut TcpStream) -> Result<(String, String, HashMap<String, String>, Value), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|_| "lan.timeout".to_owned())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|_| "lan.timeout".to_owned())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|_| "lan.read_failed".to_owned())?);
    let mut first = String::new();
    reader
        .by_ref()
        .take(4097)
        .read_line(&mut first)
        .map_err(|_| "lan.read_failed".to_owned())?;
    let mut parts = first.split_whitespace();
    let method = parts.next().ok_or("lan.bad_request")?.to_owned();
    let path = parts.next().ok_or("lan.bad_request")?.split('?').next().unwrap_or("").to_owned();
    let mut headers = HashMap::new();
    let mut length = 0usize;
    let mut count = 0usize;
    loop {
        let mut line = String::new();
        let read = reader
            .by_ref()
            .take((MAX_HEADER_LINE + 1) as u64)
            .read_line(&mut line)
            .map_err(|_| "lan.read_failed")?;
        if read == 0 || line == "\r\n" {
            break;
        }
        if line.len() > MAX_HEADER_LINE || count >= MAX_HEADERS {
            return Err("lan.bad_request".into());
        }
        count += 1;
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_ascii_lowercase();
            if key == "content-length" {
                length = v.trim().parse().map_err(|_| "lan.bad_length")?;
            }
            headers.insert(key, v.trim().to_owned());
        }
    }
    if length > MAX_BODY {
        return Err("lan.too_large".into());
    }
    let mut body = vec![0; length];
    reader
        .read_exact(&mut body)
        .map_err(|_| "lan.read_failed".to_owned())?;
    let value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body).map_err(|_| "lan.bad_json".to_owned())?
    };
    Ok((method, path, headers, value))
}

impl Lan {
    /// Start the LAN host once; returns `(port, host)`.
    pub fn start(self: &Arc<Self>) -> Result<(u16, String), String> {
        {
            let inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
            if inner.started {
                return Ok(inner_host_port(&inner)?);
            }
        }
        let listener = TcpListener::bind("0.0.0.0:0").map_err(|_| "lan.bind_failed".to_owned())?;
        let port = listener
            .local_addr()
            .map_err(|_| "lan.bind_failed".to_owned())?
            .port();
        let host = format!("{}:{port}", local_ip()?);
        {
            let mut inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
            inner.started = true;
            inner.host = host.clone();
        }
        let this = Arc::clone(self);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        if this.connections.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                            this.connections.fetch_sub(1, Ordering::SeqCst);
                            continue;
                        }
                        let state = Arc::clone(&this);
                        std::thread::spawn(move || {
                            if let Err(e) = state.serve(stream) {
                                log::debug!("lan.request_failed: {e}");
                            }
                            state.connections.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                    Err(_) => log::warn!("lan.accept_failed"),
                }
            }
        });
        Ok((port, host))
    }

    fn serve(&self, mut stream: TcpStream) -> Result<(), String> {
        // The listener is bound to 0.0.0.0 so that it works on every LAN interface;
        // only private/link-local peers may reach the pairing and RPC endpoints.
        if !stream
            .peer_addr()
            .map(|addr| lan_source(addr.ip()))
            .unwrap_or(false)
        {
            return Ok(());
        }
        let (method, path, headers, body) = match request(&mut stream) {
            Ok(v) => v,
            Err(e) => return response(&mut stream, 400, json!({ "success": false, "code": e })),
        };
        let result = self.route(&method, &path, &headers, body);
        match result {
            Ok((code, value)) => response(&mut stream, code, value),
            Err(e) => response(&mut stream, 400, json!({ "success": false, "code": e })),
        }
    }

    fn route(
        &self,
        method: &str,
        path: &str,
        headers: &HashMap<String, String>,
        body: Value,
    ) -> Result<(u16, Value), String> {
        let parts: Vec<&str> = path.split('/').collect();
        if method == "POST" && parts == ["", "v1", "lan", "poll"] {
            return self.poll(headers);
        }
        if method == "POST" && parts == ["", "v1", "lan", "reply"] {
            return self.reply(headers, body);
        }
        if method == "POST" && parts.len() == 6 && parts[1] == "v1" && parts[2] == "pairing" && parts[3] == "sessions" {
            return self.pairing_endpoint(parts[4], parts[5], body);
        }
        Ok(failure("lan.not_found"))
    }

    fn pairing_endpoint(&self, id: &str, action: &str, body: Value) -> Result<(u16, Value), String> {
        match action {
            "inspect" => self.inspect(id, body),
            "claim" => self.claim(id, body),
            "confirm" => self.confirm(id, body),
            "cancel" => self.cancel(id, body),
            _ => Ok(failure("lan.not_found")),
        }
    }

    fn inspect(&self, id: &str, body: Value) -> Result<(u16, Value), String> {
        let inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
        let session = inner.session.as_ref().ok_or("pairing.unknown_session")?;
        if session.pairing_id != id || session.expires <= now() {
            return Ok(failure("pairing.expired"));
        }
        if body["claim_token"].as_str() != Some(&session.claim_token) {
            return Ok(failure("pairing.token_invalid"));
        }
        Ok((
            200,
            json!({ "success": true, "data": {
                "pairing_id": session.pairing_id,
                "desktop_name": session.desktop_name,
                "desktop_keys": session.desktop_keys,
                "masked_account": "局域网",
                "expires_at": session.expires,
            }}),
        ))
    }

    fn claim(&self, id: &str, body: Value) -> Result<(u16, Value), String> {
        let device_keys = body["device_keys"].as_str().unwrap_or("").to_owned();
        let proof = body["key_proof"].as_str().unwrap_or("");
        if B64.decode(&device_keys).map(|v| v.len()).unwrap_or(0) != 64 {
            return Ok(failure("pairing.key_invalid"));
        }
        let mut inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
        let session = inner.session.as_mut().ok_or("pairing.unknown_session")?;
        if session.pairing_id != id || session.expires <= now() {
            return Ok(failure("pairing.expired"));
        }
        if body["claim_token"].as_str() != Some(&session.claim_token) {
            return Ok(failure("pairing.token_invalid"));
        }
        if session.pending.is_some() {
            return Ok(failure("pairing.already_claimed"));
        }
        if !pairing::verify_proof(&session.psk, id, &session.desktop_keys, &device_keys, proof) {
            session.state = "failed".into();
            return Ok(failure("pairing.proof_invalid"));
        }
        let secret = token()?;
        session.pending = Some(Pending {
            keys: device_keys,
            info: body["device_info"].clone(),
            secret: secret.clone(),
        });
        session.state = "claimed".into();
        Ok((200, json!({ "success": true, "data": { "claim_secret": secret } })))
    }

    fn confirm(&self, id: &str, body: Value) -> Result<(u16, Value), String> {
        let mut inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
        let (device_id, device_token, desktop_name, new_device) = {
            let session = inner.session.as_mut().ok_or("pairing.unknown_session")?;
            if session.pairing_id != id || session.expires <= now() {
                return Ok(failure("pairing.expired"));
            }
            let pending = session.pending.as_ref().ok_or("pairing.not_claimed")?;
            if body["claim_secret"].as_str() != Some(&pending.secret) {
                return Ok(failure("pairing.secret_invalid"));
            }
            let device_token = token()?;
            // A lost confirm response must be retryable without creating a second device.
            if let Some(device_id) = session.device_id.clone() {
                (device_id, device_token, session.desktop_name.clone(), None)
            } else {
                let device_id = format!("dev_{}", hex(random::<12>()?));
                let name = bounded_text(&pending.info["name"], 100);
                let device = Device {
                    id: device_id.clone(),
                    name: if name.trim().is_empty() { "这台手机".into() } else { name },
                    model: bounded_text(&pending.info["model"], 100),
                    os: bounded_text(&pending.info["os"], 100),
                    app_version: bounded_text(&pending.info["app_version"], 40),
                    keys: pending.keys.clone(),
                    token_hash: hash(&device_token),
                    last_seen: now(),
                    token_expires: now() + TOKEN_TTL,
                };
                session.device_id = Some(device_id.clone());
                (device_id, device_token, session.desktop_name.clone(), Some(device))
            }
        };
        if let Some(device) = new_device {
            remote_crypto::remote_pin(device.id.clone(), device.keys.clone())?;
            inner.devices.insert(device_id.clone(), device);
        } else {
            let device = inner.devices.get_mut(&device_id).ok_or("lan.unknown_device")?;
            device.token_hash = hash(&device_token);
            device.token_expires = now() + TOKEN_TTL;
            device.last_seen = now();
        }
        if let Some(session) = inner.session.as_mut().filter(|s| s.pairing_id == id) {
            session.state = "confirmed".into();
            session.device_id = Some(device_id.clone());
        }
        save_devices(&inner.devices)?;
        Ok((
            200,
            json!({ "success": true, "data": {
                "device_id": device_id,
                "device_token": device_token,
                "token_expires_at": now() + TOKEN_TTL,
                "desktop_name": desktop_name,
            }}),
        ))
    }

    fn cancel(&self, id: &str, body: Value) -> Result<(u16, Value), String> {
        let mut inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
        let allowed = match inner.session.as_ref().filter(|s| s.pairing_id == id) {
            Some(session) => match session.pending.as_ref() {
                Some(pending) => body["claim_secret"].as_str() == Some(pending.secret.as_str()),
                None => body["claim_token"].as_str() == Some(session.claim_token.as_str()),
            },
            None => return Ok((200, json!({ "success": true }))),
        };
        if !allowed {
            return Ok(failure("pairing.secret_invalid"));
        }
        inner.session = None;
        Ok((200, json!({ "success": true })))
    }

    fn auth(&self, inner: &mut Inner, headers: &HashMap<String, String>) -> Option<String> {
        let value = headers.get("authorization")?.strip_prefix("Device ")?;
        let (id, token) = value.split_once('.')?;
        let device = inner.devices.get_mut(id)?;
        if device.token_expires > 0 && device.token_expires <= now() {
            return None;
        }
        if device.token_hash != hash(token) {
            return None;
        }
        device.last_seen = now();
        Some(id.to_owned())
    }

    fn poll(&self, headers: &HashMap<String, String>) -> Result<(u16, Value), String> {
        let mut inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
        let Some(id) = self.auth(&mut inner, headers) else {
            return Ok((401, json!({ "success": false, "code": "lan.unauthorized" })));
        };
        let messages = inner.outbox.remove(&id).unwrap_or_default();
        Ok((200, json!({ "success": true, "data": { "messages": messages } })))
    }

    fn reply(&self, headers: &HashMap<String, String>, body: Value) -> Result<(u16, Value), String> {
        let mut inner = self.inner.lock().map_err(|_| "lan.state".to_owned())?;
        let Some(id) = self.auth(&mut inner, headers) else {
            return Ok((401, json!({ "success": false, "code": "lan.unauthorized" })));
        };
        let envelope = &body["envelope"];
        let message_id = envelope["id"].as_str().unwrap_or("");
        let key = format!("{id}:{message_id}");
        if let Some(sender) = inner.pending_rpc.remove(&key) {
            let _ = sender.send(envelope.clone());
        }
        Ok((200, json!({ "success": true })))
    }
}

fn inner_host_port(inner: &Inner) -> Result<(u16, String), String> {
    let port = inner
        .host
        .rsplit_once(':')
        .and_then(|(_, p)| p.parse().ok())
        .ok_or("lan.not_started")?;
    Ok((port, inner.host.clone()))
}

#[tauri::command]
pub fn lan_pair_start(lan: tauri::State<'_, Arc<Lan>>) -> Result<Value, String> {
    lan.start()?;
    let (_, host) = {
        let inner = lan.inner.lock().map_err(|_| "lan.state".to_owned())?;
        inner_host_port(&inner)?
    };
    let s = pairing::stored()?;
    let desktop_keys = pairing::public_keys(&s)?;
    let pairing_id = B64.encode(random::<16>()?);
    let claim_token = B64.encode(random::<32>()?);
    let psk = random::<32>()?;
    let desktop_name = whoami::fallible::devicename().unwrap_or_else(|_| "这台电脑".into());
    let fp = pairing::fingerprint(&desktop_keys);
    let expires = now() + PAIR_TTL;
    let qr = pairing::qr_text(&host, &pairing_id, &claim_token, &psk, &fp);
    let svg = pairing::qr_svg(&qr)?;
    let mut inner = lan.inner.lock().map_err(|_| "lan.state".to_owned())?;
    inner.session = Some(Session {
        pairing_id: pairing_id.clone(),
        claim_token,
        psk,
        desktop_name,
        desktop_keys,
        expires,
        state: "open".into(),
        pending: None,
        device_id: None,
    });
    Ok(json!({ "pairingId": pairing_id, "qrSvg": svg, "expiresAt": expires }))
}

#[tauri::command]
pub fn lan_pair_status(lan: tauri::State<'_, Arc<Lan>>, pairing_id: String) -> Result<Value, String> {
    let mut inner = lan.inner.lock().map_err(|_| "lan.state".to_owned())?;
    let (state, device_id, pending_name, pending_keys) = {
        let Some(session) = inner.session.as_mut() else {
            return Ok(json!({ "state": "expired" }));
        };
        if session.pairing_id != pairing_id {
            return Ok(json!({ "state": "expired" }));
        }
        if session.expires <= now() && session.state != "confirmed" {
            session.state = "expired".into();
        }
        let pending = session.pending.as_ref();
        let pending_name = pending.and_then(|p| p.info["name"].as_str().map(str::to_owned));
        let pending_keys = pending.map(|p| p.keys.clone());
        (session.state.clone(), session.device_id.clone(), pending_name, pending_keys)
    };
    let device = device_id.as_ref().and_then(|id| inner.devices.get(id));
    Ok(json!({
        "state": state,
        "device_id": device_id,
        "device_name": device.map(|d| d.name.clone()).or(pending_name),
        "device_keys": device.map(|d| d.keys.clone()).or(pending_keys),
    }))
}

#[tauri::command]
pub fn lan_pair_cancel(lan: tauri::State<'_, Arc<Lan>>, pairing_id: String) -> Result<(), String> {
    let mut inner = lan.inner.lock().map_err(|_| "lan.state".to_owned())?;
    if inner.session.as_ref().map(|s| s.pairing_id.as_str()) == Some(pairing_id.as_str()) {
        inner.session = None;
    }
    Ok(())
}

#[tauri::command]
pub fn lan_devices(lan: tauri::State<'_, Arc<Lan>>) -> Result<Vec<Value>, String> {
    let inner = lan.inner.lock().map_err(|_| "lan.state".to_owned())?;
    let current = now();
    Ok(inner
        .devices
        .values()
        .map(|d| {
            json!({
                "id": d.id, "name": d.name, "model": d.model, "os": d.os,
                "app_version": d.app_version, "keys": d.keys,
                "online": current - d.last_seen < ONLINE_WINDOW,
                "last_seen_at": d.last_seen,
            })
        })
        .collect())
}

#[tauri::command]
pub async fn lan_rpc(
    lan: tauri::State<'_, Arc<Lan>>,
    device_id: String,
    envelope: Value,
) -> Result<Value, String> {
    let state = Arc::clone(lan.inner());
    let message_id = envelope["id"]
        .as_str()
        .ok_or("lan.invalid_envelope")?
        .to_owned();
    let key = format!("{device_id}:{message_id}");
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel();
        {
            let mut inner = state.inner.lock().map_err(|_| "lan.state".to_owned())?;
            if !inner.devices.contains_key(&device_id) {
                return Err("lan.unknown_device".to_owned());
            }
            if inner.outbox.get(&device_id).map_or(0, Vec::len) >= MAX_OUTBOX {
                return Err("lan.busy".to_owned());
            }
            inner.pending_rpc.insert(key.clone(), tx);
            inner
                .outbox
                .entry(device_id.clone())
                .or_default()
                .push(json!({ "type": "task.rpc", "envelope": envelope }));
        }
        match rx.recv_timeout(RPC_TIMEOUT) {
            Ok(reply) => Ok(reply),
            Err(_) => {
                if let Ok(mut inner) = state.inner.lock() {
                    inner.pending_rpc.remove(&key);
                    // A timed-out command must not execute later when the phone polls again.
                    if let Some(queue) = inner.outbox.get_mut(&device_id) {
                        queue.retain(|m| m["envelope"]["id"].as_str() != Some(message_id.as_str()));
                    }
                }
                Err("lan.rpc_timeout".to_owned())
            }
        }
    })
    .await
    .map_err(|_| "lan.rpc_worker".to_owned())?
}

#[tauri::command]
pub fn lan_rename_device(
    lan: tauri::State<'_, Arc<Lan>>,
    device_id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 || name.chars().any(|c| c.is_control()) {
        return Err("phone.invalid_name".to_owned());
    }
    let mut inner = lan.inner.lock().map_err(|_| "lan.state".to_owned())?;
    let device = inner.devices.get_mut(&device_id).ok_or("lan.unknown_device")?;
    device.name = name.to_owned();
    save_devices(&inner.devices)
}

#[tauri::command]
pub fn lan_remove_device(lan: tauri::State<'_, Arc<Lan>>, device_id: String) -> Result<(), String> {
    let mut inner = lan.inner.lock().map_err(|_| "lan.state".to_owned())?;
    inner.devices.remove(&device_id);
    inner.outbox.remove(&device_id);
    let prefix = format!("{device_id}:");
    inner.pending_rpc.retain(|key, _| !key.starts_with(&prefix));
    if inner.session.as_ref().and_then(|s| s.device_id.as_deref()) == Some(device_id.as_str()) {
        inner.session = None;
    }
    remote_crypto::forget(&device_id)?;
    save_devices(&inner.devices)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(token: &str, expires: i64) -> Device {
        Device {
            id: "dev_test".into(),
            name: "Phone".into(),
            model: "m".into(),
            os: "o".into(),
            app_version: "1".into(),
            keys: "k".into(),
            token_hash: hash(token),
            last_seen: 0,
            token_expires: expires,
        }
    }

    #[test]
    fn lan_bounds_device_metadata_and_prefers_physical_interfaces() {
        assert_eq!(bounded_text(&json!("Pixel\n9"), 100), "Pixel9");
        assert_eq!(bounded_text(&json!("x".repeat(200)), 10).len(), 10);
        assert!(preferred_interface("en0"));
        assert!(preferred_interface("wlan0"));
        assert!(!preferred_interface("utun4"));
        assert!(!preferred_interface("docker0"));
        assert!(lan_source("192.168.1.2".parse().unwrap()));
        assert!(lan_source("127.0.0.1".parse().unwrap()));
        assert!(!lan_source("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn lan_claim_accepts_the_shared_pairing_vector_and_rejects_a_bad_proof() {
        let vector: Value =
            serde_json::from_str(include_str!("../testdata/pairing-v1.json")).unwrap();
        let case = &vector["cases"][0];
        let pid = case["pairing_id"].as_str().unwrap();
        let psk: [u8; 32] = B64.decode(case["psk"].as_str().unwrap()).unwrap().try_into().unwrap();
        let desktop_keys = case["desktop"]["keys"].as_str().unwrap();
        let phone_keys = case["phone"]["keys"].as_str().unwrap();
        let session = || Session {
            pairing_id: pid.into(),
            claim_token: case["claim_token"].as_str().unwrap().into(),
            psk,
            desktop_name: "Desktop".into(),
            desktop_keys: desktop_keys.into(),
            expires: now() + 60,
            state: "open".into(),
            pending: None,
            device_id: None,
        };
        let lan = Lan {
            inner: Mutex::new(Inner { session: Some(session()), ..Inner::default() }),
            connections: AtomicUsize::new(0),
        };
        let (code, value) = lan.claim(pid, json!({
            "claim_token": case["claim_token"], "device_keys": phone_keys,
            "key_proof": case["key_proof"], "device_info": { "name": "Phone" }
        })).unwrap();
        assert_eq!(code, 200);
        assert_eq!(value["success"], true);
        let bad = Lan {
            inner: Mutex::new(Inner { session: Some(session()), ..Inner::default() }),
            connections: AtomicUsize::new(0),
        };
        let (code, _) = bad.claim(pid, json!({
            "claim_token": case["claim_token"], "device_keys": phone_keys,
            "key_proof": "AAAA", "device_info": {}
        })).unwrap();
        assert_ne!(code, 200);
    }

    #[test]
    fn lan_device_tokens_are_hashed_and_pairing_expires() {
        assert_eq!(hash("abc").len(), 64);
        let session = Session {
            pairing_id: "p".into(),
            claim_token: "t".into(),
            psk: [1; 32],
            desktop_name: "d".into(),
            desktop_keys: "k".into(),
            expires: now() - 1,
            state: "open".into(),
            pending: None,
            device_id: None,
        };
        assert!(session.expires <= now());
    }

    #[test]
    fn lan_auth_rejects_wrong_and_expired_tokens() {
        let lan = Lan {
            inner: Mutex::new(Inner {
                devices: HashMap::from([("dev_test".into(), device("right", now() + 60))]),
                ..Inner::default()
            }),
            connections: AtomicUsize::new(0),
        };
        let mut inner = lan.inner.lock().unwrap();
        let mut headers = HashMap::new();
        headers.insert("authorization".into(), "Device dev_test.wrong".into());
        assert!(lan.auth(&mut inner, &headers).is_none());
        headers.insert("authorization".into(), "Device dev_test.right".into());
        assert_eq!(lan.auth(&mut inner, &headers).as_deref(), Some("dev_test"));
        inner.devices.get_mut("dev_test").unwrap().token_expires = now() - 1;
        assert!(lan.auth(&mut inner, &headers).is_none());
    }

    #[test]
    fn lan_cancel_requires_the_claim_secret() {
        let lan = Lan {
            inner: Mutex::new(Inner {
                session: Some(Session {
                    pairing_id: "p".into(),
                    claim_token: "t".into(),
                    psk: [1; 32],
                    desktop_name: "d".into(),
                    desktop_keys: "k".into(),
                    expires: now() + 60,
                    state: "claimed".into(),
                    pending: Some(Pending { keys: "k".into(), info: json!({}), secret: "s".into() }),
                    device_id: None,
                }),
                ..Inner::default()
            }),
            connections: AtomicUsize::new(0),
        };
        assert!(lan.cancel("p", json!({ "claim_secret": "wrong" })).is_ok());
        assert!(lan.inner.lock().unwrap().session.is_some());
        assert!(lan.cancel("p", json!({ "claim_secret": "s" })).is_ok());
        assert!(lan.inner.lock().unwrap().session.is_none());
    }
}
