# Source snapshots

OSS-01 imports current tracked source, with a separate sanitization layer and no private Git history.

| Component | Snapshot | Origin/attribution |
| --- | --- | --- |
| Desktop | `a94638942bbffec8fe1adbccd82c0ca717f01695` | Lom desktop client (0.3.4 sanitized snapshot; account/billing/WeChat/server/updater excluded) |
| Core | `87906dcbed00315f4548fa8c43c483cbbdb05284` | Lom changes based on AionCore; Apache-2.0 |
| Android | `174facc57e4a86c37297ba5896c5af4dfcf0aa08` | Lom changes based on OpenMinis; GPL-3.0 |
| Protocol | `3b9d1b297babc45b6f3b9050f8488aaa7c6203bf` | Device contract snapshot including schema/generated bindings, MIT OR Apache-2.0 |

Protocol `main` at migration time contained only a scaffold; the recorded contract snapshot supplies the actual generated contract already referenced by the clients. Pending private feature PRs are not merged or implicitly included. Upstream and vendored third-party notices are retained in their respective source trees.
