# Lom community source

This repository contains the desktop client, local execution core, Android client, and device protocol source in one place. It is a source distribution for community development, without the commercial account, billing, model gateway, pairing relay, operations console, or deployment services.

**It does not connect to an official Lom cloud by default.** Configure your own model provider for ordinary desktop tasks. The account-dependent Personal Agent and desktop-to-phone pairing/remote control are not standalone features in this distribution. There is no implemented Lom LAN transport; adding direct connections or a self-hosted relay is community integration work. The Android app retains its local features and client-side protocol source. Its upstream developer debug server is not a replacement for Lom pairing.

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
