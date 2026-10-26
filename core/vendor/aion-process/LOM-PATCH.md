Source: iOfficeAI/aionrs v0.2.11 (8e61a90), Apache-2.0.

Local patch: cancelling CommandRunner on Unix kills its process group on drop.
Upstream kill_on_drop only killed the direct shell, leaving descendants alive.
Normal completion retains upstream background-process behavior. Windows already
uses a kill-on-close job object; that path is unchanged, not tested on macOS.
Workspace-only metadata was expanded; workspace-hack is a feature-unification
helper and is not used by this crate's source.

Regression: abort an actually running shell with a child and delayed filesystem
write; both processes must exit and the delayed write must never happen.
