# Lom community source

This repository contains the desktop client, local execution core, Android client, and device protocol source in one place. It is a source distribution for community development, without the commercial account, billing, model gateway, cloud pairing relay, operations console, or deployment services. The community desktop and Android client can pair over a local network by QR; LAN messages use signed encrypted envelopes.

**It does not connect to an official Lom cloud by default.** Configure your own model provider for ordinary desktop tasks. Account-dependent Personal Agent features still require a compatible service, but desktop-to-phone LAN pairing is implemented locally: the desktop hosts a one-time QR session and the phone connects directly on the same private network. The Android app also retains its local features and protocol source. Its upstream developer debug server is not a replacement for Lom LAN pairing.

LAN pairing is intended for a trusted private network. Pairing and control HTTP traffic is cleartext and uses a one-time QR secret plus a bearer device token; remote RPC payloads are signed encrypted envelopes. Do not expose the LAN port to the internet or an untrusted network.

## Source layout

| Directory | Contents | License |
| --- | --- | --- |
| `apps/desktop` | React/TypeScript UI and Tauri desktop shell | AGPL-3.0-only |
| `core` | Local Rust execution core, based on AionCore | Apache-2.0; see component notices |
| `apps/android` | Mobile source based on OpenMinis; Lom changes target Android | GPL-3.0; see third-party licenses |
| `protocol` | Device schema, generated bindings and test vectors | MIT OR Apache-2.0 |

These are separate programs communicating through protocols, not a relicensing of their components. Preserve each component's notices when redistributing. The included iOS source is upstream material, not a claim that Lom iPhone pairing is supported.

## Build

See [BUILDING.md](BUILDING.md) for the independent desktop, core and Android toolchains. No production keys, signing certificates, application installers or bundled desktop executables are supplied. Upstream mobile build assets are identified in the build guide. Desktop and mobile are not implicitly verified by a successful frontend build.

See [the source snapshot record](docs/SOURCE_SNAPSHOTS.md) and [release boundaries](docs/OPEN_SOURCE_SCOPE.md). Private Git histories and commercial server sources are not imported. Historical public commits remain available in this repository's Git history.

Before publishing changes, run `python3 tools/audit-source.py` and the relevant component tests. The audit reports paths/rule names only and never prints matching secret values. It is one review layer, not a guarantee that source is free of every possible sensitive datum.
