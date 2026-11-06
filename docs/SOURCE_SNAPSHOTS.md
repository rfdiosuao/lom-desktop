# Source snapshots

OSS-01 imports current tracked source, with a separate sanitization layer and no private Git history.

| Component | Snapshot | Origin/attribution |
| --- | --- | --- |
| Desktop | `58ad82c9e0897e45a37e48b7bd87491dca81cb0c` | Lom desktop client (0.3.8 sanitized snapshot; community service guards, namespace and LAN transport retained) |
| Core | `4adbdfa2f532bcb7f07fcfb199678707cbaa9391` | Lom changes based on AionCore; Apache-2.0; reviewed Cargo.lock included |
| Android | `174facc57e4a86c37297ba5896c5af4dfcf0aa08` | Lom changes based on OpenMinis; GPL-3.0 |
| Protocol | `3b9d1b297babc45b6f3b9050f8488aaa7c6203bf` | Device contract snapshot including schema/generated bindings, MIT OR Apache-2.0 |

Protocol `main` at migration time contained only a scaffold; the recorded contract snapshot supplies the actual generated contract already referenced by the clients. Pending private feature PRs are not merged or implicitly included. Upstream and vendored third-party notices are retained in their respective source trees.

The 2026-11-06 refresh imports committed file deltas through a three-way merge against the previous exported source. It does not import private commits/history. Community adaptations remain: separate desktop data/credential identity, no default commercial or connector endpoints, no official updater, and local LAN pairing. Android and protocol snapshots are unchanged; local uncommitted Android work was not included. Documentation contracts do not imply that every optional device method has been implemented or tested.
