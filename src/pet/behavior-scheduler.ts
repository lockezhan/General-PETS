import { MotionConfig } from '../shared/character-types';
import { PetSettings } from '../shared/pet-settings';

export type BehaviorType = "walk" | "sit" | "idle" | "expression";

export class BehaviorScheduler {
  private timer: number | null = null;
  private onSchedule: (type: BehaviorType) => void;

  constructor(onSchedule: (type: BehaviorType) => void) {
    this.onSchedule = onSchedule;
  }

  public scheduleNext(motionConfig: MotionConfig, settings: PetSettings) {
    this.cancel();
    
    // We always run the scheduler, even if settings.autoMovementEnabled is false,
    // so stationary behaviors (sit, expression, idle) can still run.

    const delay = Math.random() * (motionConfig.idleDelayMaxMs - motionConfig.idleDelayMinMs) + motionConfig.idleDelayMinMs;

    this.timer = window.setTimeout(() => {
      this.timer = null;
      
      const r = Math.random() * 100;
      let type: BehaviorType = "idle";
      
      if (r < 35) {
        type = "idle";
      } else if (r < 55) {
        type = "expression";
      } else if (r < 85) {
        // If stroll/walk is disabled, we fallback to stationary expression
        type = settings.autoMovementEnabled ? "walk" : "expression";
      } else {
        type = "sit";
      }
      
      console.log(`[behavior] scheduled type=${type} after ${delay.toFixed(0)}ms (r=${r.toFixed(1)})`);
      this.onSchedule(type);
    }, delay);
  }

  public cancel(reason?: string) {
    if (this.timer !== null) {
      if (reason) console.log(`[behavior] cancelled reason=${reason}`);
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
