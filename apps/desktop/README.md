# Lom community desktop

React/TypeScript frontend and Tauri shell, synchronized with desktop 0.3.8. The local execution core is included at `../../core`; its pinned model SDK dependency is public. Source, packaged installers and update delivery are separate artifacts.

See [the monorepo build guide](../../BUILDING.md). In this directory run `npm ci`, `npm run typecheck`, `npm test -- --maxWorkers=2`, and `npm run build`. Tauri additionally requires the locally built core and verified official Lark CLI sidecar. Binaries, signing keys and local `.env` files are not committed.

Features are organized under `src/features`; shared UI/styles under `src/shared`; local core REST/WebSocket transport under `src/core`; native process, keychain, clipboard and bridge code under `src-tauri`. Preserve launch-token authentication and existing tool approvals.

Community builds open the ordinary task shell without an account service. Configure your own model provider in settings. Official login/billing/model gateway, account-dependent Personal Agent, cloud phone pairing/relay and automatic official updates are not bundled. QR pairing with the standalone community Android pairing client is implemented over a private LAN. It does not provide a public self-hosted relay or verify full phone automation.

Tools, skills and role templates share the capabilities hub. MCP services are user-configured. Set `VITE_LOM_CONNECTOR_URL` only if you operate a self-hosted connector service; no official or maintainer host is configured by default. Windows distribution is paused; macOS and source development continue.

License: AGPL-3.0-only for this shell/frontend, with component notices in `src-tauri/licenses` and vendored dependencies. See the root README for the separate core, mobile and protocol licenses.
