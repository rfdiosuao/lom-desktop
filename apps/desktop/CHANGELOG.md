# Desktop source changes

## Unreleased

- Windows 使用 Lom 自己的顶栏和最小化 / 最大化 / 关闭按钮，不再显示系统深色标题栏；保留拖动、双击最大化和边缘缩放。
- 启动 lom-core 时不再创建可见控制台窗口，避免打开桌面应用时额外弹出终端。

## 0.1.6 — 2026-10-18

- Browse Agent history independently from the current chat using a larger circular logo picker and a fine hover outline; keep activity rings on working conversation logos.
- Add side chat to the compact plus menu and reduce slash-menu row height.
- Keep thinking/tool spinners continuous during updates and animate sidebar expansion smoothly.

- Search-session setup is optional and bounded; failure does not block normal cloud models, and logout/reconnect clears the search binding.
- Correct external-agent permission values and live/recovered approval cards; render structured questions and preserve neutral status when another client resolves a request.
- Bound stop requests, reconcile late message registration and stop delegated work independently; protect previews and account state from stale responses.
- Restore complete paginated history after reconnect, preserve failed-send attachments and per-phone document drafts, and retain account-scoped phone/team configuration across logout.
- Keep composer controls usable at the supported 880px minimum window width without changing saved panel preferences.
- Consolidate the desktop, login, phone, team, updater, website and npm installer development line on `main`, including the IM01 requirements document.
- Organize desktop UI, actions and runtime adapters by feature; keep transport, shared components, application state and demo fixtures in named directories.
- Preserve existing routes, API and event contracts, preferences, update signatures and user interactions.
- Add repository and desktop architecture guides and checks for the maintained `main` branch.

Delivery 034 publishes verified Mac and Windows installers and signed update manifests for 0.1.6. IM01 roadmap entries retain their individual planned or candidate status.
