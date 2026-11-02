# Contributing

Start with [README.md](README.md), [BUILDING.md](BUILDING.md), and the relevant component's contributor instructions. Keep changes scoped to the desktop shell, local core, mobile app or protocol; preserve component licenses and upstream attribution.

The commercial backend is not part of this repository. Do not add production endpoints, credentials, signing material, local user data or private repository dependencies. Community LAN/relay work should be a separate proposal with its own authentication and threat model; this export does not implement that transport.

Run the publication audit against both worktree and staged files, plus relevant behavioral tests. A source-text boundary check is a publication guard, not proof of runtime behavior. Record unexecuted platform/device checks honestly. Do not weaken desktop loopback authentication or tool approvals when making a component work independently.
