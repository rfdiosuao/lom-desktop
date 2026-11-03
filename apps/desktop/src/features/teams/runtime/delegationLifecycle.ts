import { captureDelegation, invalidateDelegations, settleDelegations, trackDelegation } from '@/features/chat/runtime/turnLedger';

/* 成员派发的代次和在途派发由会话操作记录统一持有（REFACTOR-01 模块 1）；这里保留原有对外名称。 */

/** Called synchronously when stopping begins, before any cancellation requests. */
export { invalidateDelegations, captureDelegation, trackDelegation };

/** Keep stop unconfirmed until in-flight admissions and any late cleanup have settled. */
export const stopDelegationAdmissions = settleDelegations;
