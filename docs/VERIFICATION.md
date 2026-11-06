# OSS-01 verification

2026-10-26, source-only community consolidation.

- Desktop frontend: 180 files / 1,279 behavioral tests passed; type checking and Vite build passed. After example-domain cleanup, account/community targeted tests passed 13/13.
- Desktop native shell: 62 tests passed, 3 existing manual integration tests ignored. Local sidecar resources were supplied for compilation only; no desktop core/Lark sidecar executable is staged or distributed. This is not a signed installer or installed GUI acceptance result.
- Local core: debug `aioncore` binary built from exported source; sanitized session fixtures passed 609 tests; launch guard passed 7 tests; cloud-search adapter targeted tests passed 10 tests. Full core workspace tests were not run.
- Isolated core smoke: started with a fresh data directory; authenticated provider-list request returned 200 and the same route without launch token returned 401. No model, paid API, IM or phone task was sent. Existing installed app/user data were not changed.
- Android: 3 source/manifest/vector publication checks passed. These do not execute Android behavior. JDK 21 launched Gradle, but JVM pairing tests were blocked by the required Java 17 toolchain; no passing APK, iOS, device, PRoot/rootfs or mobile transport result is claimed. The CI pairing job provisions JDK 17 separately.
- Protocol: generator ran; pairing vector QR/host consistency passed; TypeScript generated bindings match the desktop copy. Rust client bindings retain the subset used by this desktop snapshot; the schema also supplies four newer phone-subagent structures. Shared structure fields were checked against the schema. No protobuf tree exists in this snapshot, so buf checks are not claimed.
- Publication audit: worktree and staged-blob scans passed with 0 findings across all staged source files before push; the scanner reports paths/rules and never secret values. Deterministic pairing vectors and explicit `example.*` URL-rejection fixtures remain as test data. Audit coverage is not a universal guarantee against every possible sensitive datum.

Official cloud endpoints, updater verification key/configuration, server deployment code, private source history, user databases/logs, local credentials, signing material, build caches and application installers are not part of the source export. Upstream Android Gradle wrapper and pinned PRoot loader assets are retained with their existing build/provenance notices. Full packaged builds and remaining community transport integration are separate work. No pull request is merged and no commercial deployment is changed.

Mechanical imports preserve upstream whitespace, including vendored C sources and patches; a repository-wide whitespace cleanup is not claimed.

Tracked native build intermediate files from the upstream LAME directory were excluded; its source/configure inputs remain. Archive XML/JSON/properties text is also scanned for the same sensitive patterns.


## 2026-11-03 community desktop 0.3.4 sync

- Desktop frontend typecheck passed.
- Desktop tests: 259 files / 1,784 tests passed (Node 24 semantics; local Node 25 used `NODE_OPTIONS=--no-experimental-webstorage`).
- Production Vite build passed.
- `python3 tools/audit-source.py`: 4,725 files audited, 0 findings.
- `python3 apps/android/tests/check_public_boundary.py`: 3 tests passed.
- Commercial account, billing, purchase, WeChat, server, deployment and automatic-update code remain excluded; community guards keep the app usable with a self-configured model provider.
- Community Mac DMG built locally from the sanitized source with the verified local core binary; version, community identifier, signature, DMG checksum and Finder layout were verified. No Windows artifact or real-device installation is claimed.


## 2026-11-06 / 07 community desktop 0.3.8 sync

- Desktop frontend: 322 files / 2,228 behavioral tests passed; TypeScript and the production Vite build passed. Default builds do not configure a cloud or hosted connector service. The unconfigured MCP UI remains usable and does not advertise unavailable hosted connections.
- Desktop native shell: 111 tests passed; 3 existing manual tests ignored. Community app identity, SSH credential service names and temporary identity files use separate namespaces. Test-only sidecar resources are excluded from source publication.
- Android pairing JVM module: 21 tests passed with JDK 17. Three mobile source publication-boundary checks passed. No full Android Agent APK or device acceptance test is claimed. The committed Android snapshot is unchanged; unrelated local uncommitted Android changes are not included.
- Protocol generator completed with no generated binding changes. Local documentation links were checked. Twelve publication/runner behavioral checks passed. Worktree source scanning reports 0 findings; staged blobs are checked again before push.
- Core workspace Clippy passed against the reviewed, committed upstream lockfile. The publication gate runs the full workspace tests before pushing. On this small Mac build volume the opt-in runner executes every expected library, binary and integration target in selector groups, preserves feature unification, verifies target coverage and reclaims only generated test executables. It fails on missing targets or failing tests. As with the default nextest gate, doctests are outside this gate.
- The full test run exposed an existing sanitized fixture mismatch: a mixed-case developer path was compared to another username's lowercase path. The paired synthetic paths now name the same user; an added negative case keeps different user folders distinct. No production canonicalization behavior was changed.
- Migration immutability checks now cover both a standalone core and the exported monorepo layout. Unix behavior tests passed; PowerShell source was adapted but not executed on Windows.
- Windows distribution is paused. Source/configuration is retained, and no Windows installer or update is published in this sync. Packaged desktop releases, installed GUI validation, real model calls and real external-channel/server operations are separate from the source checks above.
