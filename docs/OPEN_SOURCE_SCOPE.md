# OSS-01 source publication boundary

This source-only migration imports tracked snapshots, not private Git history, local settings, build caches, user documents, credential stores or installed binaries. Commercial server code (`crates/lom-server`), `deploy`, the account/admin website and payment/model gateway infrastructure are excluded. The HTTP service inside `core` is the local desktop execution API and must remain.

Official cloud login, update delivery and automatic phone pairing/reconnection are disabled or unconfigured. Client adapters and protocol definitions remain as reference source; their presence does not provide the missing backend. Personal Agent account/model restrictions are documented rather than silently bypassed. No new LAN, VPN, relay server or offline Personal Agent is implemented in this migration.

Community desktop builds use a distinct application identifier and credential namespace to avoid reading commercial app data. Production model credentials, tokens, private signing keys and local paths must not be added. Fictional protocol vectors and deliberately synthetic cryptographic test keys are test data, not deployment configuration. Root submodule metadata pins the public OpenMinis iSH/PRoot dependencies; nested original metadata documents their origin.

Licensing remains per component. Sharing a repository does not link the GPL mobile program into the desktop core. Local fixture redaction preserves event structure, not the original private transcript content. Detailed upstream attribution and notices remain with each component.

Publication is by reviewable pull request. Do not merge, publish signed binaries or change commercial deployments as a consequence of this migration. Remaining integration and build limits are listed in the PR and verification record.
