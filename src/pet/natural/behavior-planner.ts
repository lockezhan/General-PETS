import { BehaviorContext } from './natural-types';
import { PetSettings } from '../../shared/pet-settings';

export interface PlannedBehavior {
  id: string;
  logicalAction: "idle" | "walk" | "sit" | "wave" | "hop" | "fail" | "run" | "review";
  targetDirection?: "left" | "right";
  durationMs?: number;
}

export const ACTION_TRANSITIONS: Record<string, Record<string, number>> = {
  idle: { idle: 30, walk: 22, sit: 15, wave: 10, review: 10, hop: 6, run: 5, fail: 2 },
  walk: { idle: 45, sit: 25, review: 15, wave: 10, walk: 5 },
  sit: { idle: 50, wave: 20, review: 20, walk: 10 },
  wave: { idle: 70, sit: 15, review: 15 },
  review: { idle: 70, sit: 20, walk: 10 },
};

export class BehaviorPlanner {
  private timer: number | null = null;
  private onPlanReady: (plan: PlannedBehavior) => void;
  private lastUserInteractionAt: number = 0;

  constructor(onPlanReady: (plan: PlannedBehavior) => void) {
    this.onPlanReady = onPlanReady;
  }

  public recordUserInteraction(now: number = performance.now()) {
    this.lastUserInteractionAt = now;
  }

  public scheduleNext(
    settings: PetSettings,
    context: BehaviorContext,
    availableActions: string[]
  ) {
    this.cancel("reschedule");

    let baseDelay = Math.random() * 8000 + 12000;
    if (settings.ambientBehaviorFrequency === "low") baseDelay *= 1.5;
    if (settings.ambientBehaviorFrequency === "high") baseDelay *= 0.7;

    this.timer = window.setTimeout(() => {
      this.timer = null;
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

    // 上下文法则：用户刚互动完 0~5 秒内，不随机走开或沮丧，优先 idle / wave
    if (timeSinceUserMs < 5000) {
      console.log(`[behavior-planner] user interaction fresh (${(timeSinceUserMs / 1000).toFixed(1)}s ago), staying idle/wave`);
      return {
        id: `plan-${now}`,
        logicalAction: Math.random() > 0.4 ? "idle" : "wave",
        durationMs: 3000
      };
    }

    const last = context.lastActionId || "idle";
    const transitions = ACTION_TRANSITIONS[last] || ACTION_TRANSITIONS.idle;

    // 复制基础权重矩阵
    const weights: Record<string, number> = { ...transitions };

    // 应用边缘避让法则
    if (context.nearLeftEdge && weights.walk) {
      weights.walk *= 0.5;
    }
    if (context.nearRightEdge && weights.walk) {
      weights.walk *= 0.5;
    }

    // 自动位移关闭控制
    if (!settings.autoMovementEnabled && weights.walk) {
      weights.walk = 0;
    }

    // 可用动作过滤
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
      durationMs: selectedAction === "walk" ? Math.random() * 5000 + 4000 : 3000
    };
  }

  public cancel(reason?: string) {
    if (this.timer !== null) {
      if (reason) console.log(`[behavior-planner] cancelled reason=${reason}`);
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
