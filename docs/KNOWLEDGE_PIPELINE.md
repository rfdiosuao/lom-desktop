# 知识沉淀与复利资产流水线

> 目标：让一次任务产生的经验，在下一次任务中被检索、验证和复用，并在稳定后升级为可执行 Skill。
>
> 公开边界：本仓库只包含**策略层**（`src/knowledge/policy.ts`）与本文档。候选抽取、持久化、模型调用、Skill 发布由私有运行时接线；这里不包含账号、云端或手机实现。

## 1. 第一性原理

1. **知识不是文档，是可验证的断言。** 没有触发条件、边界和验证方法的总结，不应进入知识库。
2. **沉淀是例外，不是常态。** 普通成功不写；只有失败后修复、用户纠正、重复出现、人工反馈等带信号的任务才写。
3. **冲突不可静默覆盖。** 同一触发条件下的不同结论必须显式标记冲突，由人或后续证据裁决。
4. **复用才有价值。** 衡量指标是“下一次首解率/耗时”，不是条目数量。增长快于复用就是文档债。
5. **对外必须有人工闸门。** 自动生成 issue/PR 草稿，但发布前由人确认。

## 2. 三层资产模型

| 层 | 内容 | 存储 | 作用 |
| --- | --- | --- | --- |
| L1 事件 | 会话、工具调用、失败码、耗时、成本、用户纠正 | 追加写、不可变 | 证据来源，可追溯 |
| L2 知识 | `fact` / `decision` / `playbook` / `pitfall` 条目 | SQLite + FTS5 | 可检索、可合并、可过期 |
| L3 能力 | `SKILL.md`（输入/输出/权限/验收） | 技能目录 + Skillhub | 可执行、可版本化、可分发给所有使用者 |

升级路径：**L1 证据 → L2 条目 → 复用反馈 → L3 Skill**。没有 L1 证据的 L2 条目不成立；没有复用记录的 L3 不升级。

## 3. 触发：什么值得沉淀

`shouldDistill(trace)` 只在以下信号出现时返回 true：

- 失败后重试并恢复（`failure-recovery`）
- 部分完成且用户纠正（`partial-correction` / `user-correction`）
- 同类问题跨会话重复出现（`recurring`）
- 人工正向反馈且带验证（`verified-success`）
- 人工负向反馈（`negative-feedback`）
- 高成本成功且带验证（`expensive-success`，默认 ≥10 分钟）

普通成功、闲聊、无法验证的推测一律不写。

## 4. 候选结构（L2）

每条知识必须包含：

| 字段 | 说明 |
| --- | --- |
| `kind` | `fact` / `decision` / `playbook` / `pitfall` |
| `scope` | `project` / `user` / `team` / `public`，默认 `project` |
| `domain` | 稳定命名空间，例如 `lom.core.lifecycle` |
| `trigger` | 什么条件下适用（用于检索匹配） |
| `claim` | 一句话结论，必须可判断真假 |
| `boundary` | 反例与失效条件；`pitfall` / `playbook` 必填 |
| `verification` | 如何验证，必须可执行 |
| `evidence` | 至少一个带 `toolCallId` 的证据引用 |
| `confidence` | 0–0.95，由证据数与反馈计算 |
| `dedupeKey` | `scope + domain + kind + 规范化 trigger` 的稳定哈希 |
| `ttlDays` | `fact` 默认 365 天，其余 90 天 |
| `status` | `candidate` / `active` / `conflicted` / `expired` / `rejected` |

拒绝码：`NO_EVIDENCE`、`NO_VERIFICATION`、`TOO_SHORT`、`NO_BOUNDARY`、`SECRET_DETECTED`、`PII_REQUIRES_REVIEW`、`LOW_CONFIDENCE`、`PUBLIC_NEEDS_APPROVAL`。

## 5. 置信度、合并与冲突

- 置信度从 0.4 起；每个独立会话 +0.1（最多 +0.3）；成功证据 +0.1；人工正向 +0.1；负向 −0.2；有验证 +0.1。
- 单次观测的 `decision` / `playbook` 置信度封顶 **0.6**，不允许凭一次经验固化成规则。
- 同一 `dedupeKey` 且结论一致：合并证据，置信度按 `1-(1-a)(1-0.6b)` 提升。
- 同一 `dedupeKey` 但结论不同：返回 `conflict`，两条都保留，等待人工或新证据裁决。
- 负向反馈使置信度 −0.1；低于 0.4 自动转为 `conflicted`，停止注入。
- 超过 `ttlDays` 未验证视为过期，注入时降权 0.2。

## 6. 检索与注入

`rankForInjection(items, { scope, context, limit, tokenBudget })`：

- 只返回 `active` 且在调用方可见范围内的条目。可见性：`project` 可见 `project/user/team/public`，`public` 只可见 `public`。
- 排序：相关性 0.45、置信度 0.25、新鲜度 0.15、使用效果 0.15；过期乘 0.2。
- 默认 Top-5、约 1200 token 预算；只注入“触发条件 + 一句话结论 + id”，详情通过工具按需读取。
- 每次注入记录 `retrievals`；被采纳记 `adoptions`；导致回归记 `regressions`。

## 7. 洞察 → Issue / PR

同一套策略也用于“有价值项的提出”：

1. **结构化洞察卡**：`problem / evidence / impact / scope / proposed_change / verification / effort / confidence / dedupe_key`。
2. **去重**：`insightKey(component, symptom)` 稳定哈希；同 key 合并证据，不重复提。
3. **价值评分**：`insightScore = impact × frequency × verifiability / (125 × effort)`，取值 0–1。
4. **闸门**：低于 0.35 只进 backlog；达到阈值先出草稿；对外发布必须人工确认。
5. **回流**：issue 被合并、关闭或拒绝都写回知识库，避免反复提出同一问题。

## 8. 升级为 Skill（L3）

满足全部条件才可升级：

- `status = active`
- 置信度 ≥ 0.75
- 被采纳 ≥ 3 次
- 回归次数 = 0
- 创建满 7 天

升级时生成 `SKILL.md`，必须写明：适用触发、输入、输出、所需权限、失败处理、验收方法、来源证据与许可证。发布到 Skillhub 前走脱敏扫描。

## 9. 隐私与治理

- 默认 `project` 作用域，本地保存；跨项目复用需显式提升到 `user`。
- 密钥、私钥、Bearer token 一律拒绝入库；`public` 额外检查邮箱/手机号等 PII。
- 发布前执行公开脱敏扫描；不提交生产日志、个人路径、用户会话原文。
- 知识条目支持 `supersedes` 与 TTL；每周体检：过期、冲突、未验证、增长/复用比。

## 10. 指标

| 指标 | 说明 |
| --- | --- |
| 复用率 | 条目被检索并采纳的比例 |
| 首解率 | 同类任务第 3 次的一次成功率 |
| 成本 | 平均耗时与 token 成本变化 |
| 质量 | 过期率、冲突率、回归率、回滚率 |
| 外部贡献 | issue/PR 草稿的维护者接受率 |
| 反指标 | 条目增长速度 > 复用增长速度 → 暂停沉淀，先压缩 |

## 11. 落地计划

**M1（1 周）**：接入 `policy.ts`，只启用 `fact` / `pitfall`；实现任务后触发、证据引用、FTS5 检索、Top-K 注入；全部 `project` 作用域。

**M2（1 周）**：合并/冲突、反馈统计、过期与周报；接入洞察卡与 issue 草稿（人工闸门）；选定一个域验证（建议 `lom.core.lifecycle`，以 #4 / #5 的排查过程作为第一条种子知识）。

**M3（后续）**：满足晋升条件的条目升级为 Skill，接入 Skillhub；再评估向量检索与跨项目复用。

## 12. 验收

- 结束核心进程后，同类任务第 3 次的首解率或耗时优于第 1 次。
- 至少一条知识被检索并采纳；过期/冲突条目不会进入注入。
- 含密钥或 PII 的候选 100% 被拒绝。
- 重复运行不会产生重复 issue 草稿。
- 知识库增长/复用比保持可控，周报能指出需要压缩的域。
