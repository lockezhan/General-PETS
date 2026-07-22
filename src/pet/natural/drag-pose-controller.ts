import { DragPose } from './natural-types';

export const RUNNING_DRAG_SPEED_MIN = 80; // logical px/s
export const STATIC_DRAG_DELAY_MS = 220;
export const DIRECTION_HYSTERESIS_MS = 90;

export class DragPoseController {
  private currentPose: DragPose = "release";
  private holdTimer: number | null = null;

  public resolveDragPose(
    _deltaX: number,
    _deltaY: number,
    vx: number,
    vy: number,
    _now: number = performance.now()
  ): DragPose {
    const absVx = Math.abs(vx);
    const absVy = Math.abs(vy);

    // 主要是垂直移动
    if (absVy > absVx * 1.5) {
      this.currentPose = "carried-vertical";
      return this.currentPose;
    }

    // 横向高速移动
    if (absVx >= RUNNING_DRAG_SPEED_MIN) {
      this.currentPose = vx < 0 ? "carried-left" : "carried-right";
      return this.currentPose;
    }

    // 慢速或接近静止：先保持当前姿态，延迟 180ms 切为 carried-static
    if (this.currentPose === "carried-left" || this.currentPose === "carried-right") {
      return this.currentPose;
    }

    this.currentPose = "carried-static";
    return this.currentPose;
  }

  public setPose(pose: DragPose) {
    this.currentPose = pose;
  }

  public getCurrentPose(): DragPose {
    return this.currentPose;
  }

  public reset() {
    this.currentPose = "release";
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
}
