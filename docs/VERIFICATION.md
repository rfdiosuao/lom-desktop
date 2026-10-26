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
