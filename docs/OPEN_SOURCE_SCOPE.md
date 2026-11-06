# Community source publication boundary

This repository imports reviewed source snapshots, not private Git history, local settings, build caches, user documents, credential stores or installed binaries. Commercial server code (`crates/lom-server`), `deploy`, the account/admin website and payment/model gateway infrastructure are excluded. The HTTP service inside `core` is the local desktop execution API and must remain.

Official cloud login, update delivery and cloud phone pairing/reconnection are disabled or unconfigured. The community desktop hosts a local QR pairing session and uses the existing signed envelope protocol over a private LAN; it never contacts a Lom relay. The LAN transport is cleartext HTTP on private addresses with encrypted payloads, not a public server. Client adapters and protocol definitions remain as reference source; their presence does not provide the missing backend. Personal Agent account/model restrictions are documented rather than silently bypassed. USB transport, VPN and self-hosted relay servers remain unimplemented.

The root READMEs retain explicitly allowlisted public product/documentation links and official product screenshots. This does not configure a runtime service or make hosted features available in a community build. API paths, query-bearing URLs, credentials and official endpoints in program configuration remain subject to the publication audit.

Community desktop builds use a distinct application identifier and credential namespace to avoid reading commercial app data. Production model credentials, tokens, private signing keys and local paths must not be added. Fictional protocol vectors and deliberately synthetic cryptographic test keys are test data, not deployment configuration. Root submodule metadata pins the public OpenMinis iSH/PRoot dependencies; nested original metadata documents their origin.

Licensing remains per component. Sharing a repository does not link the GPL mobile program into the desktop core. Local fixture redaction preserves event structure, not the original private transcript content. Detailed upstream attribution and notices remain with each component.

Source updates are reviewed through pull requests and component checks before publication. A source synchronization does not itself produce a tested installer or deploy commercial services. Packaged artifacts have separate build and verification records. Remaining integration and build limits are listed in the PR and verification record.
