export const TOUCH_SESSION_GRACE_MS = 450;
export const TOUCH_MAX_CONTINUOUS_MS = 8000;

export type ReactionType = "touch-head" | "touch-body" | "pickup";

export class ReactionSession {
  public readonly id: string;
  public readonly type: ReactionType;
  public readonly startedAt: number;
  public lastExtendedAt: number;
  public active: boolean = true;
  public finishedReason: string | null = null;

  constructor(type: ReactionType, now: number = performance.now()) {
    this.id = `reaction-${Math.random().toString(36).substring(2, 9)}`;
    this.type = type;
    this.startedAt = now;
    this.lastExtendedAt = now;
  }

  public extend(now: number = performance.now()): boolean {
    if (!this.active) return false;

    if (now - this.startedAt >= TOUCH_MAX_CONTINUOUS_MS) {
      this.finish("max-duration-reached");
      return false;
    }

    this.lastExtendedAt = now;
    return true;
  }

  public isWithinGracePeriod(now: number = performance.now()): boolean {
    if (!this.active) return false;
    return now - this.lastExtendedAt <= TOUCH_SESSION_GRACE_MS;
  }

  public finish(reason: string) {
    if (!this.active) return;
    this.active = false;
    this.finishedReason = reason;
    console.log(`[reaction-session] finished id=${this.id} type=${this.type} reason=${reason}`);
  }

  public cancel(reason: string) {
    if (!this.active) return;
    this.active = false;
    this.finishedReason = `cancel:${reason}`;
    console.log(`[reaction-session] cancelled id=${this.id} type=${this.type} reason=${reason}`);
  }
}
