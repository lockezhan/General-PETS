import { MotionConfig } from '../shared/character-types';
import { PetSettings } from '../shared/pet-settings';

export type AutonomousActionId =
  | "idle"
  | "walk"
  | "sit"
  | "wave"
  | "hop"
  | "fail"
  | "run"
  | "review";

export interface AutonomousActionDefinition {
  id: AutonomousActionId;
  animation: string;
  weight: number;
  loop: boolean;
  minDurationMs?: number;
  maxDurationMs?: number;
  requiresGround: boolean;
  movesWindow: boolean;
  cooldownMs: number;
}

export const DEFAULT_CODEX_AUTONOMOUS_ACTIONS: AutonomousActionDefinition[] = [
  {
    id: "idle",
    animation: "idle",
    weight: 32,
    loop: true,
    minDurationMs: 4000,
    maxDurationMs: 10000,
    requiresGround: true,
    movesWindow: false,
    cooldownMs: 0,
  },
  {
    id: "walk",
    animation: "walk",
    weight: 22,
    loop: true,
    minDurationMs: 4000,
    maxDurationMs: 9000,
    requiresGround: true,
    movesWindow: true,
    cooldownMs: 0,
  },
  {
    id: "sit",
    animation: "sit",
    weight: 14,
    loop: true,
    minDurationMs: 3000,
    maxDurationMs: 8000,
    requiresGround: true,
    movesWindow: false,
    cooldownMs: 0,
  },
  {
    id: "wave",
    animation: "happy",
    weight: 10,
    loop: false,
    requiresGround: true,
    movesWindow: false,
    cooldownMs: 15000,
  },
  {
    id: "hop",
    animation: "landing",
    weight: 7,
    loop: false,
    requiresGround: true,
    movesWindow: false,
    cooldownMs: 20000,
  },
  {
    id: "fail",
    animation: "angry",
    weight: 3,
    loop: false,
    requiresGround: true,
    movesWindow: false,
    cooldownMs: 40000,
  },
  {
    id: "run",
    animation: "running",
    weight: 5,
    loop: true,
    minDurationMs: 2000,
    maxDurationMs: 4000,
    requiresGround: true,
    movesWindow: false,
    cooldownMs: 25000,
  },
  {
    id: "review",
    animation: "shy",
    weight: 7,
    loop: false,
    requiresGround: true,
    movesWindow: false,
    cooldownMs: 18000,
  },
];

export class BehaviorScheduler {
  private timer: number | null = null;
  private onSchedule: (action: AutonomousActionDefinition) => void;
  private lastExecutedAt: Map<AutonomousActionId, number> = new Map();
  private lastActionId: AutonomousActionId | null = null;
  private repeatCount = 0;

  constructor(onSchedule: (action: AutonomousActionDefinition) => void) {
    this.onSchedule = onSchedule;
  }

  public scheduleNext(
    motionConfig: MotionConfig,
    settings: PetSettings,
    availableActions: AutonomousActionDefinition[] = DEFAULT_CODEX_AUTONOMOUS_ACTIONS
  ) {
    this.cancel();

    const delay =
      Math.random() * (motionConfig.idleDelayMaxMs - motionConfig.idleDelayMinMs) +
      motionConfig.idleDelayMinMs;

    this.timer = window.setTimeout(() => {
      this.timer = null;
      const now = performance.now();

      const candidates = availableActions.filter((act) => {
        if (!settings.autoMovementEnabled && act.movesWindow) {
          return false;
        }

        const lastTime = this.lastExecutedAt.get(act.id) || 0;
        if (now - lastTime < act.cooldownMs) {
          return false;
        }

        if (this.lastActionId === act.id && this.repeatCount >= 2 && act.id !== "idle") {
          return false;
        }

        return true;
      });

      if (candidates.length === 0) {
        const fallback = availableActions.find((a) => a.id === "idle") || DEFAULT_CODEX_AUTONOMOUS_ACTIONS[0];
        this.executeAction(fallback);
        return;
      }

      const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
      let r = Math.random() * totalWeight;

      let selected = candidates[0];
      for (const c of candidates) {
        if (r < c.weight) {
          selected = c;
          break;
        }
        r -= c.weight;
      }

      this.executeAction(selected);
    }, delay);
  }

  private executeAction(action: AutonomousActionDefinition) {
    const now = performance.now();
    this.lastExecutedAt.set(action.id, now);

    if (this.lastActionId === action.id) {
      this.repeatCount++;
    } else {
      this.lastActionId = action.id;
      this.repeatCount = 1;
    }

    console.log(`[behavior] scheduled action=${action.id} anim=${action.animation} weight=${action.weight}`);
    this.onSchedule(action);
  }

  public cancel(reason?: string) {
    if (this.timer !== null) {
      if (reason) console.log(`[behavior] cancelled reason=${reason}`);
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
