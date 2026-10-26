# Lom device protocol source

This snapshot includes the string-only JSON contract in `schema/remote-v1.json`, generated Rust/TypeScript/Kotlin bindings, pairing/envelope test vectors, and protocol documents. It is shared protocol material, not an implementation of the excluded hosted account/pairing/relay server.

Regenerate bindings using `python3 tools/generate-remote.py`. The clients contain their build-ready copies; regeneration writes only `generated/`, so review synchronization explicitly. Deterministic vector keys are fictional test material. QR hosts use example domains, not production services.

`buf.yaml` is historical configuration for a planned protobuf tree; this snapshot has no `proto/` tree and does not claim a passing buf check. The current device client contract is the included JSON schema. Public/community transport work must preserve authentication, encryption, approvals, and compatibility rather than treating a wire schema as authorization.

License: MIT OR Apache-2.0. Preserve both license files and each consumer's separate license.
