import { toast } from '../overlays/controller';

/** No execution receipt means no success state or success notification. */
export const unavailable = (feature: string) => toast(`${feature}暂未接入，未执行任何操作。`, 'info');

export const PENDING_PREFERENCES: Record<string, string> = {};
