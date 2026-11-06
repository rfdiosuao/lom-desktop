# CI-DISK-01: bound workspace CI artifact size

The Test job for lom-core PR #14 failed before executing tests: run
40433461028, job 121956444220 ended with rustc-LLVM output failure and
`No space left on device` while compiling websocket_e2e. Format, Clippy and
Migration Immutability jobs passed. This is not evidence of a failing test case.

Set dev/test debug information to zero and disable incremental compilation for
CI. Keep the same unoptimized build, warnings-as-errors and complete workspace
nextest command. Rotate the Rust cache prefix so oversized artifacts from the
old profile are not restored into the new build. Do not remove test coverage,
ignore failures, change production release profiles, or install on user machines.

The same environment was used for local full workspace verification of the team
contract and permission fixes. YAML syntax and diff checks are required locally;
the hosted run remains the verification of actual runner disk capacity.

Logging is sufficient: Cargo profile output and the CI job result expose build
success/failure; no new application logs are needed.

Hosted follow-up: debug-free profiles still exhausted the runner during compilation (run 40465892658). Pin Ubuntu 24.04, rotate the cache namespace, and remove only preinstalled Android/.NET SDKs from the ephemeral Test runner before compilation. Print disk availability before/after; retain the complete workspace suite. Official runner-images scripts document /usr/local/lib/android/sdk and /usr/share/dotnet. No local user files are removed. Hosted capacity remains unverified until the new run passes.
