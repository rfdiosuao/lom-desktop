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

Node.js 25 enables experimental web storage that can conflict with jsdom tests; for that runtime use `NODE_OPTIONS=--no-experimental-webstorage npm test -- --maxWorkers=2`. Do not commit local `.env` files. With no account service configured, the app opens the ordinary desktop shell; configure a model provider through settings. Cloud Personal Agent, phone pairing/control, account/billing and signed official updates are not provided.

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
# Windows installer settings:
# npm run tauri -- build --config src-tauri/tauri.windows.conf.json
```

Community builds use a different app identifier/credential namespace. Signing and distribution require your own certificates. Official updater endpoints, public verification key and automatic update delivery are removed; no signing secret is required for source checks.

## Android

```sh
git submodule update --init --recursive
cd apps/android
# Follow BUILDING.md to prepare PRoot/rootfs/rclone/native assets first.
cd src/android
bash gradlew :app:assembleLomRelease
```

See `apps/android/BUILDING.md` for SDK/NDK/JDK/native dependencies and GPL redistribution requirements. This is more than a Gradle-only build. No SDK, full native runtime payloads or signing material are supplied. The upstream Gradle wrapper and two checksum-pinned Termux PRoot loader assets are retained; their source/provenance and build constraints remain in the mobile build scripts and notices. The Lom Android flavor has official pairing and background relay disabled. It does not implement a new LAN transport.

For pairing logic JVM tests (not APK/device verification):

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
```

Bindings already used by clients are included; generator output does not automatically overwrite client files. Protocol vectors contain deterministic test keys, never production pairing secrets. Build/test results and limitations for this migration are recorded in `docs/VERIFICATION.md`.
