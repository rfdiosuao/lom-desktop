# LAN-PAIR-01 — community LAN pairing and RPC

Community-only transport for a desktop and an Android phone on the same private network. It does not use a Lom account, cloud pairing session or relay.

## Pairing

1. The desktop starts a local HTTP listener on a random port and selects a private IPv4 address from a physical Wi-Fi/Ethernet interface.
2. It creates a five-minute session and shows `lom://pair?v=1` with `h=<ip:port>` and the existing `p`, `t`, `k`, `f` fields from R01. The `psk` is in the QR only.
3. The phone confirms `h` is private IPv4:port, fetches `POST /v1/pairing/sessions/{id}/inspect`, checks the desktop key fingerprint from `f`, and sends `POST /v1/pairing/sessions/{id}/claim` with its public keys, device info and the R01 `key_proof`.
4. The desktop verifies the proof with the in-memory `psk`, returns a claim secret, and accepts `POST /v1/pairing/sessions/{id}/confirm` once. A repeated confirm with the same claim secret re-issues the device token for the same device so a lost response can be retried.
5. The device registry stores the phone public keys and a SHA-256 token hash; the token is valid for 90 days and is refreshed on confirmation.

The existing X25519/Ed25519 identities, key fingerprint, `key_proof`, QR parser and test vectors are reused. There is no code-pairing path in LAN mode.

## RPC

- The phone polls `POST /v1/lan/poll` every 800 ms with `Authorization: Device <device_id>.<token>`.
- The desktop queues `task.rpc` messages containing the existing signed encrypted remote envelope.
- The phone opens the envelope with its pinned desktop keys, executes the handler, and posts the signed reply to `POST /v1/lan/reply`.
- The desktop matches the reply by envelope id and resolves the waiting Tauri `lan_rpc` command. A timeout removes the queued message and reports `lan.rpc_timeout`; it never replays a timed-out command automatically.

## Security and limits

- The listener accepts only private/loopback source addresses; it binds all interfaces only so one desktop can serve whichever LAN it is on.
- Pairing/control HTTP is cleartext on the private LAN. RPC payloads are signed encrypted envelopes, but the bearer device token and pairing control messages are visible to a LAN sniffer. Use this transport only on a trusted private network and never expose the port to the internet.
- QR sessions expire after five minutes; claim tokens are one-time; device tokens are hashed at rest.
- This MVP covers pairing, device presence/rename/removal and text `phoneRpc`. File transfer, screen capture/control, schedules and offline delivery are outside LAN-PAIR-01 v1.
