# Pinned first-party Rust runtime

Source: rfdiosuao/lom-core, crates/aionui-personal-evolution, commit 8861adb55b49730e722d87ca9443324b26059b55 (license metadata follow-up to merged #8/#9). Full source revision: 8861adb55b49730e722d87ca9443324b26059b55. Source is unchanged; Cargo manifest is made standalone and the MIT license inherited from workspace metadata is included explicitly.

Vendored to permit builds without credentials for the private core repository. Only the self-contained personal experience ledger/projection/publication library is included; no cloud, billing or account services are redistributed. Update all sources and hashes together; do not maintain a separate fork.

SHA-256:

- `lib.rs`: `c0a08a879742ce3a0f9b1fea5bb9842ec4d0422e0f8f760f4c33a9d780807a1f`
- `projection.rs`: `0edf7225f740905298dbd1833dabf5541e1a7f61e7db7e727eb32f8f3fc97434`
- `publication.rs`: `90a6fd60db1d3594c241653eec4a6e50acc77a83dccd9798ee53a84f5677004f`
- `service.rs`: `3413c9e199679c0835cfa85e2f1ad98936296619f87fac8654213c6df98d00e6`
- `state.rs`: `b196eac0dad5fdf0cc91836168e9c00c44fc76b6eeccf0584efd6e530ad6af8f`

Upstream lifecycle tests are included unchanged: `e3126f0a89b7e079b136447d519022cda8f2851e03a5a1bbb7b26bae15140432`.
