# Core source distribution

This tree contains the local Rust HTTP core required by the desktop application.
Its loopback HTTP API, WebSocket services, launch guard, database migrations and
local authentication remain part of the distribution. They are not a hosted
commercial server. No new LAN or relay service is implemented here.

Hosted account, billing, gateway, search and skill publishing server implementations
are not included. Cloud search and skill publishing are unavailable by default.
An operator with a compatible service may explicitly set `LOM_SEARCH_CLOUD_URL`
before launching the core. The URL is not a credential; account credentials are
still supplied through the existing guarded session route. An unset or empty URL
returns `search.not_configured` when attempting to configure a cloud login.
This setting supplies a client endpoint only, not a self-hosted server implementation.

## Fixture sanitation

Recorded protocol fixtures retain event types, ordering, field structure and
cross-event identifiers. Captured home directory identities, email addresses and
opaque thinking signatures, human prompts, thinking, tool bodies and output text have been replaced with synthetic values. Framing, control fields and correlated identifiers remain for parser/replay tests; the fixtures no longer claim to preserve original task payloads. Generic test
paths remain generic. These fixtures document protocol shapes, not original
verbatim private captures; parser and replay tests must continue to pass.

## Licensing and dependencies

The core source derives from iOfficeAI/AionCore under Apache-2.0; see `LICENSE`.
Workspace license metadata matches that license. Keep third-party licenses with
their components, including `vendor/aion-process/LICENSE` and built-in skill
license files. Local changes to the vendored process crate are described in
`vendor/aion-process/LOM-PATCH.md`. Git dependencies on iOfficeAI/aionrs remain
pinned to v0.2.11 in Cargo.toml/Cargo.lock.
