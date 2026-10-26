# 上游同步记录（Lom Agent ← OpenMinis）

本仓库 fork 自 [OpenMinis](https://github.com/OpenMinis/OpenMinis)（GPL-3.0）。

公开导出修改（2026-10-26）：关闭云配对 UI、自动启动、旧凭据恢复和所有云 HTTP 出口；保留客户端/协议源码。以下功能台账描述历史实现，不代表公开构建可连接。

## 远程
- `upstream` = https://github.com/OpenMinis/OpenMinis.git
- Public export: Android component in the LOM monorepo.

## 基线
| 日期 | 上游提交 | 说明 |
|---|---|---|
| 2026-10-14 | `b4c0661` | 初始基线 |

本次台账核对日期：2026-10-18。功能基线为 `feat/R01-phone-pairing-ui` 的 `cff2bbb4c77f4f129c0d73cd373aa7287c67d273`。整合前 main `5db4619` 相对原 fork 基线 `b4c0661` 只有两次文档提交，Android 源码未变；因此以下上游补丁计数同时适用于这两个基线。

## 补丁预算（上游文件改动 ≤ 20 个）
当前修改 **16 个既有上游文件**，没有删除既有上游文件。原先的初始化、工具注册、设置入口、品牌资源接缝，已随 R02 扩展为下表登记的模型持久化、聊天状态与定时任务正确性修复；上游同步时均须保留并复核。

Lom 配对、传输与协议代码放在独立的 `lom-*` Gradle 模块（包名 `top.heang.lom.*`）；依赖 App 原生仓库的集成桥放在 `app/src/lom` flavor。主 source set 中新增的一个界面辅助文件另列在表后，不混入“既有上游文件”计数。

| # | 上游文件 | 改动目的 | 引入提交 |
|---|---|---|---|
| 1 | `src/android/settings.gradle.kts` | 注册独立配对模块 | `d460df5` |
| 2 | `src/android/build.gradle.kts` | 注册 library / JVM 插件，版本与上游 Kotlin 一致 | `d460df5` |
| 3 | `src/android/app/build.gradle.kts` | 依赖配对模块；独立包名/品牌 flavor、固定 NDK；增加扫码 instrumentation 依赖 | `d460df5`；`cff2bbb` 更新 Lom 版本为 `1.14-lom.2` / versionCode `29` |
| 4 | `src/android/app/src/main/java/com/openminis/app/ui/sessions/SessionListScreen.kt` | 时钟左侧增加连接入口；用户 2026-10-15 明确要求的首页 UI 扩展 | `d460df5` |
| 5 | `src/android/app/src/main/java/com/openminis/app/data/repository/ProviderRepository.kt` | 模型导入桥：加密 Key 保存与配置落盘后回执，配置失败恢复原 Key | `d460df5`；`3f63d24` 补保存失败处理 |
| 6 | `src/android/app/src/main/java/com/openminis/app/agent/SoulStore.kt` | 原生人格写入与远程 CAS 共用锁 | `d460df5` |
| 7 | `src/android/app/src/main/java/com/openminis/app/data/repository/MemoryRepository.kt` | 原生记忆写入与远程 CAS 共用锁 | `d460df5` |
| 8 | `src/android/app/src/main/java/com/openminis/app/debug/HeadlessChatRunner.kt` | 原生模型失败回执为 Error；显式选择模型先等待会话恢复并核对选择结果 | `3f63d24` |
| 9 | `src/android/app/src/main/java/com/openminis/app/scheduled/ScheduledAgentRunner.kt` | 定时任务先解析并选用已保存模型；模型缺失时报错，避免静默换源 | `3f63d24` |
| 10 | `src/android/app/src/main/java/com/openminis/app/scheduled/ScheduledTaskManager.kt` | 精确闹钟及降级注册均失败时向调用方报告失败 | `3f63d24` |
| 11 | `src/android/app/src/main/java/com/openminis/app/scheduled/ScheduledTaskStore.kt` | 同步提交并检查定时任务持久化结果 | `3f63d24` |
| 12 | `src/android/app/src/main/java/com/openminis/app/ui/chat/ChatViewModel.kt` | 为无界面执行提供等待会话恢复完成的接缝 | `3f63d24` |
| 13 | `src/android/app/src/main/java/com/openminis/app/ui/chat/ChatFlatItems.kt` | 用户气泡隐藏 Lom 每轮设置指令前缀，模型历史保留原文 | `80a0f84` |
| 14 | `src/android/app/src/main/java/com/openminis/app/MainActivity.kt` | 系统权限弹窗桥：权限组件缺少授权 Activity 的 ROM（如 Flyme OTA 版本不匹配）上，发起请求会抛 `ActivityNotFoundException` 导致崩溃；改为按“拒绝”回执，由既有设置页兜底。通用缺陷修复，可回馈上游 | 权限弹窗崩溃修复 PR |
| 15 | `src/android/app/src/main/java/com/openminis/app/ui/chat/ChatScreen.kt` | 同上：聊天界面里的系统权限桥与两处相机授权入口；失败时提示去系统设置允许，不再崩溃 | 权限弹窗崩溃修复 PR |
| 16 | `src/android/app/src/main/java/com/openminis/app/data/model/SubAgentDefinition.kt` | PHONE-01：子代理定义增加 `enabled`，禁用的定义不再接受新委派（内置项同样检查） | `8a7b225` |

另有 `8a7b225`（PHONE-01）新增 `src/android/app/src/main/java/com/openminis/app/agent/jobs/SubAgentAdmission.kt`：新委派、恢复与排队执行共用的启用检查，位于上游包内但为新增文件，不计入上表；同一提交继续修改第 5 项 `ProviderRepository.kt`（读写子代理定义并等待持久化回执）与第 12 项 `ChatViewModel.kt`（委派前检查定义是否启用、全局委派开关）。

另有 `80a0f84` 新增 `src/android/app/src/main/java/com/openminis/app/ui/chat/LomSettingsText.kt`，为上表聊天展示提供前缀过滤函数。它位于上游 UI 包内，是当前已登记的 Lom 界面辅助文件；独立模块、flavor 桥、测试和资源新增项不属于上表 15 个既有文件。

第 14、15 项同属一个修复：扫码配对页（Lom 自有的 `lom-pairing` 模块，`PairingActivity`）在相机已授权时不再走系统授权界面，授权弹窗无法打开时回报“相机不可用，请改用配对码”。该改动在独立模块内，不计入上表。

可用 `git diff --name-status 5db4619..cff2bbb -- src/android` 复核改动列表，用 `git log --reverse -- <文件>` 追溯首次引入及后续修复。`c038492`、`76261c1` 的功能改动位于新增的 Lom flavor / 模块内，没有再扩大既有上游文件计数。

## 当前功能与运行边界（源码截至 `cff2bbb`）

- `d460df5`：R01 扫码/配对码、身份/凭据、中转和撤销；R02-01 在线加密 RPC、模型导入、原生会话执行/停止、SOUL/记忆 revision 同步。App 集成桥通过 Lom flavor 清单 Provider 注册，复用原生 Agent 与资料仓库。
- `3f63d24`：用户可暂停/恢复的后台连接前台服务、开机恢复接缝、重连；加密分片附件/文件管理、原生定时任务；无障碍截图、界面树与控制，供电脑总指挥使用。`lom-pairing` 清单合并网络、相机、前台服务和通知等权限与组件。画面是周期截图，不是连续视频投屏；截图需要 Android 11+ 和无障碍权限，受保护窗口仍受系统限制。
- `80a0f84`：手机技能读取/安装/启停/卸载，电量与网络状态，计费网络截图省流，Lom 设置指令展示处理。安装走既有配对加密通道和身份隔离文件暂存。
- `c038492`：只读 `apps.list`，列可打开应用与无障碍状态，供 Leader 查询手机能力。
- `76261c1`：图片/视频保存到 MediaStore 相册；桌面通过 `device.rename` 同步 Lom 显示名。相册保存需要 Android 10+；不修改 Android 系统设备名，尚无手机本地改名入口。
- 没有离线任务派发队列或系统推送唤醒。前台服务不保证在系统强行停止、冻结、无网络或厂商省电策略下可达；定时任务按手机时区执行，精确闹钟权限缺失可能延迟。
- 完整包使用 `:app:assembleLomRelease`；`pairing-check` 只是独立配对验证包。原生依赖和签名要求见 [BUILDING.md](BUILDING.md#lom-完整-android-apk2026-10-15)。公开源码不提供发布证书。


## Public export boundary

Cloud pairing and automatic relay recovery are disabled. No commercial server or desktop LAN/USB transport is included. Historical deployment validation does not verify this export.
