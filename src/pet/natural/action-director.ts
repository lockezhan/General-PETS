import { ActionPriority, PetActionRequest } from './natural-types';
import { AnimationRenderer } from '../render/animation-renderer';

const PRIORITY_LEVELS: Record<ActionPriority, number> = {
  system: 40,
  locomotion: 30,
  interaction: 20,
  ambient: 10,
};

export class ActionDirector {
  private player: AnimationRenderer;
  private currentRequest: PetActionRequest | null = null;
  private activeToken: number = 0;
  private holdTimer: number | null = null;

  constructor(player: AnimationRenderer) {
    this.player = player;
  }

  public setRenderer(player: AnimationRenderer) {
    this.player = player;
  }

  public requestAction(request: PetActionRequest): boolean {
    const currentPriority = this.currentRequest ? PRIORITY_LEVELS[this.currentRequest.priority] : 0;
    const requestPriority = PRIORITY_LEVELS[request.priority];

    const isSameAnimation =
      this.currentRequest &&
      this.currentRequest.animation === request.animation &&
      this.player.getCurrentAnimation() === request.animation;

    // 1. extend-same 战略：相同动作不重启帧，平滑保持
    if (isSameAnimation && (request.interruptPolicy === "extend-same" || request.priority === "interaction")) {
      console.log(`[action-director] extend-same active for anim=${request.animation}`);
      if (this.holdTimer !== null) {
        clearTimeout(this.holdTimer);
        this.holdTimer = null;
      }
      return true;
    }

    // 2. 优先级判定：请求优先级必须大于等于当前动作
    if (requestPriority < currentPriority) {
      console.log(
        `[action-director] request rejected: req=${request.id}(${request.priority}) < current=${this.currentRequest?.id}(${this.currentRequest?.priority})`
      );
      return false;
    }

    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }

    const newToken = ++this.activeToken;
    this.currentRequest = request;

    console.log(
      `[action-director] action started token=${newToken} id=${request.id} anim=${request.animation} pri=${request.priority}`
    );

    const isLoopingByDefault = ['idle', 'waiting', 'running'].includes(request.animation) || request.animation.startsWith('walk');
    const shouldLoop = request.loop ?? isLoopingByDefault;

    this.player.play(request.animation, {
      loop: shouldLoop,
      fallback: request.fallback ?? "idle",
      timingOverride: request.timingOverride,
      onComplete: (_nextState) => {
        // Token 保护：确保旧的回调不会影响后来发布的新 Action
        if (this.activeToken === newToken) {
          console.log(`[action-director] action completed token=${newToken} id=${request.id}`);
          
          const finishAction = () => {
            if (this.activeToken !== newToken) return;
            this.currentRequest = null;
            if (request.onComplete) {
              request.onComplete();
            }
            if (request.fallback && request.fallback !== request.animation) {
              this.requestAction({
                id: `fallback-${request.id}`,
                animation: request.fallback,
                priority: request.priority === "system" ? "system" : "ambient",
                source: "behavior"
              });
            }
          };

          if (request.holdAfterMs && request.holdAfterMs > 0) {
            this.holdTimer = window.setTimeout(finishAction, request.holdAfterMs);
          } else {
            finishAction();
          }
        }
      }
    });

    return true;
  }

  public getCurrentRequest(): PetActionRequest | null {
    return this.currentRequest;
  }

  public getActiveToken(): number {
    return this.activeToken;
  }

  public clearCurrentAction(reason: string) {
    console.log(`[action-director] cleared current action reason=${reason}`);
    this.activeToken++;
    this.currentRequest = null;
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.player.stop();
  }
}
