# Building the community source

## Desktop frontend

Use Node.js 24 LTS, npm and the committed lockfile:

```sh
cd apps/desktop
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

Node.js 25 enables experimental web storage that can conflict with jsdom tests; for that runtime use `NODE_OPTIONS=--no-experimental-webstorage npm test -- --maxWorkers=2`. With no account service configured, the app opens the ordinary desktop shell; configure a model provider through settings. Account-dependent Personal Agent, billing, hosted relay and official automatic updates are not bundled. Local QR pairing is included; it is separate from a hosted relay.

Do not commit local `.env` files. Builds have no default cloud or connector endpoint. If you operate a compatible service, set `VITE_LOM_CLOUD_URL`; an optional self-hosted Activepieces catalog uses `VITE_LOM_CONNECTOR_URL`. These are build-time frontend settings: never put tokens, passwords, or provider keys in them. User MCP servers can also be added directly in the interface without configuring a hosted catalog.

## Local execution core and desktop shell

The core is built from this repository, not a private sidecar download:

```sh
cargo build --locked --release --manifest-path core/Cargo.toml -p aionui-app
```

Use the Rust toolchain declared by `core/rust-toolchain.toml` and a host C/C++ linker/toolchain. This build may fetch the pinned public aionrs dependency. The `core` HTTP server is the local execution API required by the desktop, not the excluded hosted business backend.

Tauri also expects the official Lark CLI sidecar. Obtain the version pinned in `packaging/lark-cli.json` from the [official releases](https://github.com/larksuite/cli/releases), verify the listed checksum, and extract the binary for your target. No CLI login credentials are included. Copy the two executables into `apps/desktop/src-tauri/binaries`:

- `aioncore-<rust-target-triple>` (from `core/target/release/aioncore`)
- `lark-cli-<rust-target-triple>` (from the verified official distribution)

Use `rustc -vV` to identify the host target. Add `.exe` to both file names on Windows. Do not publish locally copied executables as source. Then run:

```sh
cd apps/desktop
npm run tauri -- build
```

Tauri automatically merges the platform configuration, including the macOS bundle name and localizations. Community builds use the `org.lom.community.desktop` identifier and a separate credential namespace. Signing and distribution require your own certificates. Official updater endpoints, public verification key and automatic update delivery are removed; no signing secret is required for source checks. **Windows distribution is paused:** source and installer configuration remain for development, but no Windows artifact is released.

## Android

```sh
git submodule update --init --recursive
cd apps/android
# Follow BUILDING.md to prepare PRoot/rootfs/rclone/native assets first.
cd src/android
bash gradlew :app:assembleLomRelease
```

See `apps/android/BUILDING.md` for SDK/NDK/JDK/native dependencies and GPL redistribution requirements. This is more than a Gradle-only build. No SDK, full native runtime payloads or signing material are supplied. The upstream Gradle wrapper and two checksum-pinned Termux PRoot loader assets are retained; their source/provenance and build constraints remain in the mobile build scripts and notices. The full Lom Android flavor has official pairing and background relay disabled; it does not automatically enable LAN pairing in that app.

The separate **LAN pairing validation APK** includes the pairing module without the full Agent/native runtime:

```sh
# JDK 17, Android SDK 36 and the matching build tools are needed for the APK.
bash apps/android/src/android/gradlew -p apps/android/src/android/pairing-check :preview:assembleDebug --console=plain
```

This APK is a connection harness, not a substitute for the full Android Agent. Its application ID is `top.heang.lom.pairing.preview`. The desktop and phone must be on the same trusted private network.

For pairing logic JVM tests with JDK 17 (not APK/device verification):

```sh
bash apps/android/src/android/gradlew -p apps/android/src/android/pairing-check :lom-pairing-core:test --console=plain
```

## Protocol and publication checks

```sh
python3 protocol/tools/generate-remote.py
python3 -m unittest discover -s tools -p 'test_*.py'
python3 tools/audit-source.py
# After staging changes, also check exactly the to-be-published blobs:
python3 tools/audit-source.py --index
# Core checks use its own workspace below core/:
cd core
just check
```

On a small build volume, `AIONCORE_LOW_DISK_TESTS=1 just check` runs every workspace library, binary and integration-test target in selector groups. It preserves workspace feature unification, checks that Cargo emitted every expected test target, and reclaims the group's test executables after execution. Dependency caches remain; a failed or missing target fails the gate. It uses a separate `target/low-disk-tests` cache by default. If setting `CARGO_TARGET_DIR`, give it a cache dedicated to this run. Python 3.9+ is needed for this optional runner. Like the default nextest gate, it does not run doctests. `just push` also audits staged source before publication.

Bindings already used by clients are included; generator output does not automatically overwrite client files. Protocol vectors contain deterministic test keys, never production pairing secrets. Build/test results and limitations for this migration are recorded in `docs/VERIFICATION.md`.
