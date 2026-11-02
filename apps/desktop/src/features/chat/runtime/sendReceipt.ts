import type { Msg } from '@/state/types';
import type { Registration } from './cancel';

/** A response can be lost after the stream already acknowledged this message. */
export function sendReceipt(message: Msg | undefined) {
  let dispatched = false;
  const rejected = (error: unknown) => typeof (error as { status?: unknown })?.status === 'number'
    && (error as { status: number }).status >= 400 && (error as { status: number }).status < 500;
  const accepted = (error?: unknown) => !rejected(error) && !!message?.remoteId;
  const safeFailure = (error: unknown) => !dispatched || (rejected(error) && !message?.remoteId);
  const classify = (value: unknown, error?: unknown): Registration => {
    const turn = (value as { turn_id?: string } | undefined)?.turn_id;
    if (turn || accepted(error)) return { turnIds: turn ? [turn] : [], unknown: false };
    return { turnIds: [], unknown: !safeFailure(error) };
  };
  return { dispatched: () => { dispatched = true; }, accepted, safeFailure, classify };
}
