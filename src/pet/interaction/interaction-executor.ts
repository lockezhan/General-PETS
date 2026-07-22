import { InteractionAction, InteractionExecutionContext } from './interaction-types';

export interface ExecutorCallbacks {
  playAnimation: (animName: string, fallback: string | undefined, context: InteractionExecutionContext) => boolean | void;
  showDialogue: (text: string, context: InteractionExecutionContext) => void;
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

  public executeActions(actions: InteractionAction[], context: InteractionExecutionContext) {
    for (const action of actions) {
      try {
        switch (action.type) {
          case "playAnimation":
            this.callbacks.playAnimation(action.animation, action.fallback, context);
            break;
          case "showDialogue": {
            const text = this.callbacks.getRandomDialogueFromGroup(action.group);
            if (text) {
              this.callbacks.showDialogue(text, {
                ...context,
                dialogueGroup: action.group
              });
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
