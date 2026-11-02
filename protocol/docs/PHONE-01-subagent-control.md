# PHONE-01 — paired phone subagent definitions

This additive contract extends the existing encrypted `RpcRequest` transport. It does not expose an unauthenticated HTTP API. The paired phone remains authoritative; desktop drafts are not evidence of a successful write.

## Methods

| Method | Payload | Result |
| --- | --- | --- |
| `subagent.list` | `{}` | `PhoneSubAgents` |
| `subagent.save` | `SubAgentWrite` | `PhoneSubAgents` |
| `subagent.toggle` | `SubAgentAction` | `PhoneSubAgents` |
| `subagent.delete` | `SubAgentAction` (`enabled` ignored) | `PhoneSubAgents` |

All generated wire fields remain strings, consistent with remote-v1. `items` is a JSON array of `PhoneSubAgent`; `groups` is a JSON array of `{id,name}` from the phone's model groups. `enabled`, `builtin` and `delegation_enabled` are exactly `"true"` or `"false"`. Empty `model_group` means automatic model selection on the phone, not a desktop cloud model ID.

For a new definition, the client supplies a stable ID and empty revision. Existing definitions require the last returned revision; revision mismatch is `sync.conflict`, never last-writer-wins. Revision covers the definition's semantic fields, excluding update time. Native definition editing preserves the remote enable setting. Native advanced fields not exposed by this contract remain unchanged.

The phone validates roster limits, duplicate names, current model groups and built-in restrictions under the same repository lock used by native editing. A successful write response requires persistence; a partial persistence failure returns an error, not an enable/disable acknowledgement. On unknown outcomes, the desktop refreshes the authoritative list instead of automatically replaying a mutation.

`enabled` permits **new delegation or resumption**. It does not indicate a running job, start one immediately, or cancel an already running job. `delegation_enabled` reports the phone's existing global delegation switch; this contract cannot change that switch. Active-job controls and real-device acceptance remain separate work under PHONE-01.

## Compatibility

These types are additive to `feat/R01-R02-contracts`. Old phones return `remote.method_unknown`; clients must show unsupported capability, not fake a local successful save. The base contract branch must be integrated before this PR can be retargeted to `main`.

Generate with `python3 tools/generate-remote.py`; generated Kotlin/TypeScript/Rust files are committed together. Desktop and phone implementation PRs must copy this exact generated output.
