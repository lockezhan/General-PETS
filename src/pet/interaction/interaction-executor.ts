import { InteractionAction } from './interaction-types';

export interface ExecutorCallbacks {
  playAnimation: (animName: string, fallback?: string) => void;
  showDialogue: (text: string) => void;
  resetBehaviorTimer: () => void;
  cancelMotion: () => void;
  setFacing: (facing: "left" | "right") => void;
  getRandomDialogueFromGroup: (group: string) => string | null;
}

export class InteractionExecutor {
  private callbacks: ExecutorCallbacks;

  constructor(callbacks: ExecutorCallbacks) {
    this.callbacks = callbacks;
  }

  public executeActions(actions: InteractionAction[]) {
    for (const action of actions) {
      try {
        switch (action.type) {
          case "playAnimation":
            this.callbacks.playAnimation(action.animation, action.fallback);
            break;
          case "showDialogue": {
            const text = this.callbacks.getRandomDialogueFromGroup(action.group);
            if (text) {
              this.callbacks.showDialogue(text);
            } else {
              console.warn(`[executor] Dialogue group "${action.group}" not found or empty`);
            }
            break;
          }
          case "resetBehaviorTimer":
            this.callbacks.resetBehaviorTimer();
            break;
          case "cancelMotion":
            this.callbacks.cancelMotion();
            break;
          case "setFacing":
            this.callbacks.setFacing(action.facing);
            break;
          default:
            console.warn("[executor] Unknown action type:", (action as any).type);
        }
      } catch (err) {
        console.error("[executor] Error executing action:", action, err);
      }
    }
  }
}
