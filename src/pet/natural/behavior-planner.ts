import { BehaviorContext } from './natural-types';
import { PetSettings } from '../../shared/pet-settings';

export interface PlannedBehavior {
  id: string;
  logicalAction: "idle" | "walk" | "sit" | "wave" | "hop" | "fail" | "run" | "review" | "lookAround";
  targetDirection?: "left" | "right";
  durationMs?: number;
}

export const ACTION_TRANSITIONS: Record<string, Record<string, number>> = {
  idle: { idle: 22, walk: 20, sit: 15, wave: 15, review: 13, hop: 8, run: 7, lookAround: 6 },
  walk: { idle: 30, walk: 8, sit: 16, wave: 15, review: 14, hop: 9, run: 8, lookAround: 6 },
  sit: { idle: 30, walk: 18, sit: 8, wave: 16, review: 14, hop: 8, run: 6, lookAround: 6 },
  wave: { idle: 32, walk: 18, sit: 16, wave: 5, review: 13, hop: 9, run: 7, lookAround: 6 },
  review: { idle: 32, walk: 18, sit: 16, wave: 13, review: 5, hop: 9, run: 7, lookAround: 6 },
  hop: { idle: 35, walk: 18, sit: 15, wave: 13, review: 12, hop: 1, run: 6, lookAround: 6 },
  run: { idle: 35, walk: 12, sit: 16, wave: 14, review: 12, hop: 7, run: 4, lookAround: 6 },
  lookAround: { idle: 35, walk: 18, sit: 15, wave: 13, review: 12, hop: 7, run: 6, lookAround: 0 },
};

export const AMBIENT_DELAY_RANGES = {
  low: { min: 14000, max: 28000 },
  normal: { min: 7000, max: 16000 },
  high: { min: 5000, max: 11000 }
} as const;

export class BehaviorPlanner {
  private behaviorPlanTimer: number | null = null;
  private onPlanReady: (plan: PlannedBehavior) => void;
  private lastUserInteractionAt: number = Number.NEGATIVE_INFINITY;
  private lastActionId = 'idle';
  private recentActions: string[] = [];
  private actionCooldownUntil = new Map<string, number>();

  constructor(onPlanReady: (plan: PlannedBehavior) => void) {
    this.onPlanReady = onPlanReady;
  }

  public recordUserInteraction(now: number = performance.now()) {
    this.lastUserInteractionAt = now;
  }

  public recordActionStarted(actionId: string): void {
    this.lastActionId = actionId;
    this.recentActions.push(actionId);
    if (this.recentActions.length > 6) this.recentActions.shift();
  }

  public recordActionCompleted(actionId: string, now: number = performance.now()): void {
    if (actionId === 'walk') this.actionCooldownUntil.set('walk', now + 5000);
    if (actionId === 'hop') this.actionCooldownUntil.set('hop', now + 20000);
    if (actionId === 'wave' || actionId === 'review') {
      this.actionCooldownUntil.set(actionId, now + 12000);
    }
    if (actionId === 'lookAround') {
      this.actionCooldownUntil.set(actionId, now + 20000 + Math.random() * 20000);
    }
  }

  public getHistory(): { lastActionId: string; recentActions: string[] } {
    return { lastActionId: this.lastActionId, recentActions: [...this.recentActions] };
  }

  public getTimeSinceLastUserInteraction(now: number = performance.now()): number {
    return now - this.lastUserInteractionAt;
  }

  public scheduleNext(
    settings: PetSettings,
    context: BehaviorContext,
    availableActions: string[]
  ) {
    this.cancel("reschedule");

    const range = AMBIENT_DELAY_RANGES[settings.ambientBehaviorFrequency];
    const baseDelay = range.min + Math.random() * (range.max - range.min);

    this.behaviorPlanTimer = window.setTimeout(() => {
      this.behaviorPlanTimer = null;
      const plan = this.planNextBehavior(settings, context, availableActions);
      this.onPlanReady(plan);
    }, baseDelay);
  }

  public planNextBehavior(
    settings: PetSettings,
    context: BehaviorContext,
    availableActions: string[]
  ): PlannedBehavior {
    const now = performance.now();
    const timeSinceUserMs = now - this.lastUserInteractionAt;

    // 用户互动后 6 秒内不自动走开。
    if (timeSinceUserMs < 6000) {
      console.log(`[behavior-planner] user interaction fresh (${(timeSinceUserMs / 1000).toFixed(1)}s ago), staying idle`);
      return {
        id: `plan-${now}`,
        logicalAction: "idle",
        durationMs: 3000
      };
    }

    const last = this.lastActionId || context.lastActionId || "idle";
    const transitions = ACTION_TRANSITIONS[last] || ACTION_TRANSITIONS.idle;

    const weights: Record<string, number> = { ...transitions };

    // 绝对禁止 failed 进入随机动作池！
    delete weights.fail;
    delete weights.failed;

    const recent = this.recentActions;
    const lastTwo = recent.slice(-2);
    if (lastTwo.length === 2 && lastTwo[0] === lastTwo[1] && lastTwo[0] !== 'idle') {
      weights[lastTwo[0]] = 0;
    }

    for (const action of ['walk', 'hop']) {
      if ((this.actionCooldownUntil.get(action) ?? 0) > now) weights[action] = 0;
    }
    for (const action of ['wave', 'review']) {
      if ((this.actionCooldownUntil.get(action) ?? 0) > now && weights[action]) {
        weights[action] *= 0.3;
      }
    }
    if ((this.actionCooldownUntil.get('lookAround') ?? 0) > now || timeSinceUserMs < 8000) {
      weights.lookAround = 0;
    }

    // 应用边缘避让法则
    if (context.nearLeftEdge && weights.walk) {
      weights.walk *= 0.3;
    }
    if (context.nearRightEdge && weights.walk) {
      weights.walk *= 0.3;
    }

    if (!settings.autoMovementEnabled) {
      if (weights.walk) weights.walk = 0;
      if (weights.run) weights.run = 0;
    }

    for (const act of Object.keys(weights)) {
      if (act !== "idle" && !availableActions.includes(act)) {
        weights[act] = 0;
      }
    }

    const candidates = Object.keys(weights).filter((k) => weights[k] > 0);
    if (candidates.length === 0) {
      return { id: `plan-${now}`, logicalAction: "idle" };
    }

    const totalWeight = candidates.reduce((sum, k) => sum + weights[k], 0);
    let r = Math.random() * totalWeight;

    let selectedAction: PlannedBehavior["logicalAction"] = "idle";
    for (const k of candidates) {
      if (r < weights[k]) {
        selectedAction = k as PlannedBehavior["logicalAction"];
        break;
      }
      r -= weights[k];
    }

    let targetDirection: "left" | "right" | undefined = undefined;
    if (selectedAction === "walk") {
      if (context.nearLeftEdge) targetDirection = "right";
      else if (context.nearRightEdge) targetDirection = "left";
      else targetDirection = Math.random() > 0.5 ? "left" : "right";
    }

    return {
      id: `plan-${now}`,
      logicalAction: selectedAction,
      targetDirection,
      durationMs: selectedAction === "walk"
        ? Math.random() * 5000 + 4000
        : selectedAction === 'idle'
          ? Math.random() * 4500 + 4500
          : undefined
    };
  }

  public cancel(reason?: string) {
    if (this.behaviorPlanTimer !== null) {
      if (reason) console.log(`[behavior-planner] cancelled reason=${reason}`);
      clearTimeout(this.behaviorPlanTimer);
      this.behaviorPlanTimer = null;
    }
  }

  public hasScheduledPlan(): boolean {
    return this.behaviorPlanTimer !== null;
  }
}
