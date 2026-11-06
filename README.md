<p align="center"><img src="apps/desktop/public/logo.png" width="88" alt="Lom"></p>

<h1 align="center">Lom · 麓鸣</h1>
<p align="center">A desktop AI workspace for your models, computer agents, tools, and connected phones.</p>
<p align="center"><a href="README.zh-CN.md">简体中文</a> · <a href="https://lom.entermodetwo.com/en/">Official product</a> · <a href="https://github.com/rfdiosuao/lom-desktop/releases">Downloads</a> · <a href="BUILDING.md">Build from source</a> · <a href="https://github.com/rfdiosuao/lom-desktop/issues">Issues</a></p>

Choose a working folder, connect your own model provider or installed agent CLI, and follow the work in one interface. Lom brings conversations, MCP tools, skills, file changes, and agent teams together.

This is the **community edition**: desktop client, local Rust execution core, Android source, and device protocol. It does not connect to an official Lom cloud by default. Commercial account, billing, model gateway, hosted phone relay, and operations services are separate.

<p align="center">
<a href="https://github.com/rfdiosuao/lom-desktop/releases"><img alt="Community downloads" src="https://img.shields.io/badge/community-macOS%20%C2%B7%20Android-22a35a"></a>
<a href="LICENSE"><img alt="Desktop UI license" src="https://img.shields.io/badge/desktop%20UI-AGPL--3.0-blue"></a>
<a href="https://github.com/rfdiosuao/lom-desktop/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/rfdiosuao/lom-desktop?style=flat"></a>
</p>

<p align="center"><img src="docs/images/lom-workspace.jpg" alt="Lom desktop workspace with task, model, and phone controls" width="860"></p>

The screenshots show the official Lom desktop. Community capabilities and service requirements are described below.

## What is included

- **Your models and agents.** Configure provider keys or connect supported local agent CLIs. External CLIs need their own installation and authentication; availability is detected on your machine.
- **A working desktop.** Conversations, workspaces, file changes, tool activity, history, and permissions stay together. Tools report their real state and results.
- **Tools and reusable roles.** Manage MCP services, local skills, and agent profiles. Optionally configure your self-hosted Activepieces service; no hosted connector endpoint is bundled.
- **Agent teams.** The first computer member becomes leader. Follow collaboration in parallel, board, single, or group-chat views.
- **Local phone pairing.** Pair a community Android pairing client by QR on the same private network. RPC payloads use signed, encrypted envelopes. The standalone pairing APK is a transport validation app, **not the full Android Agent**.

Account-dependent Personal Agent features require a compatible service. Included client adapters do not supply that backend. Phone capabilities depend on the connected client; a frontend build or a pairing handshake does not verify full phone automation.

<p align="center"><img src="docs/images/lom-agent-menu.jpg" alt="Lom agent menu showing detected computer agents and their availability" width="680"></p>

## Downloads

Get available artifacts from [GitHub Releases](https://github.com/rfdiosuao/lom-desktop/releases). Read the release notes and verify the published SHA-256 checksum.

| Platform | Community distribution |
| --- | --- |
| macOS · Apple silicon | Community desktop DMG |
| Android | LAN pairing validation APK; full Agent source has a separate native build process |
| Windows | **Not released at present.** No Windows installer or update is currently distributed. |
| iPhone / iPad | No Lom release; retained upstream iOS source is not a support claim |

Community builds use a separate application identifier and credential namespace. They do not read the commercial desktop's account or data directory. Official automatic updates are disabled.

For the separately distributed official product and its hosted services, visit the [official website](https://lom.entermodetwo.com/en/). Community artifacts remain under GitHub Releases above.

## Develop

Use Node.js 24 LTS for the desktop frontend:

```sh
git clone --recurse-submodules https://github.com/rfdiosuao/lom-desktop.git
cd lom-desktop/apps/desktop
npm ci
npm test -- --maxWorkers=2
npm run build
```

A working desktop application also needs the locally built Rust core and verified Lark CLI sidecar. Follow [BUILDING.md](BUILDING.md) for native packaging, frontend development, Android prerequisites, and publication checks. A frontend build alone does not produce a complete application.

LAN pairing is for a trusted private network. Its pairing/control HTTP transport is cleartext; pairing uses a one-time QR secret and bearer device token, while RPC payloads are signed and encrypted. Do not expose its port to the public internet. Public self-hosted relay, USB transport, and VPN setup are not implemented here.

## Repository and licenses

| Directory | Program | License |
| --- | --- | --- |
| [`apps/desktop`](apps/desktop) | React / TypeScript frontend and Tauri shell | AGPL-3.0-only |
| [`core`](core) | Local Rust execution API, based on AionCore | Apache-2.0; component notices apply |
| [`apps/android`](apps/android) | Mobile program, based on OpenMinis | GPL-3.0; third-party notices apply |
| [`protocol`](protocol) | Device schema, generated bindings, test vectors | MIT OR Apache-2.0 |

These separate programs communicate through protocols; collecting their source here does not relicense them. Preserve the original notices. Thanks to the AionCore / AionUi, OpenMinis, Lark CLI, and other upstream contributors identified in each component.

## Acknowledgements

Thanks to [AionUi / AionCore](https://github.com/iOfficeAI/AionUi), [OpenMinis](https://github.com/OpenMinis/OpenMinis), [Lark CLI](https://github.com/larksuite/cli), and their contributors. Each included component retains its original notices.

[Mika](https://github.com/wangzan101/Mika) by wangzan101 ([Apache-2.0](https://github.com/wangzan101/Mika/blob/main/LICENSE)) is a related, separately distributed phone client. Its source is outside this snapshot; the Lom edition is separate from the original author's release.

## Contribute

Bug reports should include the community version, operating system, steps to reproduce, and a redacted error. Never attach credentials or private conversation history. See [CONTRIBUTING.md](CONTRIBUTING.md).

Source is synchronized as reviewed snapshots with a community adaptation layer, without private Git history, user data, preconfigured production service endpoints, or signing keys. Before publishing, run the component checks and worktree/staged-blob audits. The scanner reports file paths and rule names, not secret values; it is one review layer, not a universal guarantee.

[Source versions](docs/SOURCE_SNAPSHOTS.md) · [Publication boundary](docs/OPEN_SOURCE_SCOPE.md) · [Verification and limits](docs/VERIFICATION.md) · [Phone protocol](docs/open/phone-access/README.md)
