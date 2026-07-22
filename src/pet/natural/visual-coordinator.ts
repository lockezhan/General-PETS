export type PetMotionState =
  | "idle"
  | "walk-left"
  | "walk-right"
  | "drag-static"
  | "drag-left"
  | "drag-right"
  | "drag-vertical"
  | "falling"
  | "landing";

export type PetReactionState =
  | "idle"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export interface ResolvedVisualAction {
  animation: string;
  source: "physics" | "drag" | "walk" | "user-reaction" | "ambient-reaction" | "idle";
  priorityRank: number;
}

export class PetVisualCoordinator {
  private motionState: PetMotionState = "idle";
  private reactionState: PetReactionState = "idle";
  private reactionSource: "user" | "ambient" = "ambient";

  public setMotionState(state: PetMotionState) {
    console.log(`[visual-coordinator] motionState=${state}`);
    this.motionState = state;
  }

  public setReactionState(state: PetReactionState, source: "user" | "ambient" = "user") {
    console.log(`[visual-coordinator] reactionState=${state} source=${source}`);
    this.reactionState = state;
    this.reactionSource = source;
  }

  public clearMotionState(_reason: string) {
    this.motionState = "idle";
  }

  public clearReactionState(_reason: string) {
    this.reactionState = "idle";
    this.reactionSource = "ambient";
  }

  public getMotionState(): PetMotionState {
    return this.motionState;
  }

  public getReactionState(): PetReactionState {
    return this.reactionState;
  }

  public resolveEffectiveAnimation(): ResolvedVisualAction {
    // 1. 物理优先级最高的下落与落地 (falling / landing)
    if (this.motionState === "falling") {
      return { animation: "jumping", source: "physics", priorityRank: 60 };
    }
    if (this.motionState === "landing") {
      return { animation: "jumping", source: "physics", priorityRank: 60 };
    }

    // 2. 原生拖拽中姿态 (drag)
    if (this.motionState.startsWith("drag")) {
      let anim = "waiting";
      if (this.motionState === "drag-left") anim = "running-left";
      if (this.motionState === "drag-right") anim = "running-right";
      if (this.motionState === "drag-vertical") anim = "jumping";
      return { animation: anim, source: "drag", priorityRank: 50 };
    }

    // 3. 自动行走 (walk)
    if (this.motionState === "walk-left") {
      return { animation: "running-left", source: "walk", priorityRank: 40 };
    }
    if (this.motionState === "walk-right") {
      return { animation: "running-right", source: "walk", priorityRank: 40 };
    }

    // 4. 用户主动交互 Reaction
    if (this.reactionState !== "idle" && this.reactionSource === "user") {
      return { animation: this.mapReactionToAnimation(this.reactionState), source: "user-reaction", priorityRank: 30 };
    }

    // 5. 环境随机 Reaction
    if (this.reactionState !== "idle" && this.reactionSource === "ambient") {
      return { animation: this.mapReactionToAnimation(this.reactionState), source: "ambient-reaction", priorityRank: 20 };
    }

    // 6. 默认 Idle
    return { animation: "idle", source: "idle", priorityRank: 10 };
  }

  private mapReactionToAnimation(reaction: PetReactionState): string {
    switch (reaction) {
      case "waving": return "waving";
      case "jumping": return "jumping";
      case "failed": return "failed";
      case "waiting": return "waiting";
      case "running": return "running";
      case "review": return "review";
      default: return "idle";
    }
  }
}
