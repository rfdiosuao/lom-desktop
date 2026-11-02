# Lom community desktop

React/TypeScript frontend and Tauri shell. The local execution core is included at `../../core`, not fetched from a private source repository. This source snapshot is based on desktop 0.2.5; source, signed installers and update delivery are separate artifacts.

See [the monorepo build guide](../../BUILDING.md). In this directory run `npm ci`, `npm run typecheck`, `npm test -- --maxWorkers=2`, and `npm run build`. Tauri additionally requires the locally built core and verified official Lark CLI sidecar. Binaries, signing keys and local `.env` files are not committed.

Features are organized under `src/features`; shared UI/styles under `src/shared`; local core REST/WebSocket transport under `src/core`; native process, keychain, clipboard and bridge code under `src-tauri`. Preserve launch-token authentication and existing tool approvals.

Community builds open the ordinary task shell without an account service. Configure your own model provider in settings. Official login/billing/model gateway, account-bound Personal Agent, cloud phone pairing/relay and automatic official updates are not bundled. Client adapters remain for community adaptation; this migration adds no LAN or self-hosted relay implementation.

License: AGPL-3.0-only for this shell/frontend, with component notices in `src-tauri/licenses` and vendored dependencies. See the root README for the separate core, mobile and protocol licenses.
