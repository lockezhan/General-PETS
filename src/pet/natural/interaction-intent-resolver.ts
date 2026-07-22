import { InteractionIntent, NaturalPointerSession } from './natural-types';

export class InteractionIntentResolver {
  public resolveIntent(session: NaturalPointerSession, isPointerUp: boolean): InteractionIntent {
    if (session.cancelled) return "none";

    // 1. Pickup 提起（最强优先级，且必须位于 pickup 区分）
    if (session.pickupCommitted) {
      return "pickup";
    }

    // 2. Stroke 抚摸
    if (session.strokeCommitted) {
      return "stroke";
    }

    // 3. LongPress 长按 (pointerup 时若已达标且未拉动)
    if (session.longPressEligible && isPointerUp) {
      return "longPress";
    }

    return "none";
  }
}
