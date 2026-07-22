import { DragPose } from './natural-types';

export class DragPoseController {
  private currentPose: DragPose = "release";

  public resolveDragPose(
    deltaLogicalX: number,
    direction: "left" | "right" | null
  ): DragPose {
    if (!direction) {
      this.currentPose = "carried-static";
      return this.currentPose;
    }

    if (Math.abs(deltaLogicalX) >= 2) {
      this.currentPose = direction === "left" ? "carried-left" : "carried-right";
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
  }
}
