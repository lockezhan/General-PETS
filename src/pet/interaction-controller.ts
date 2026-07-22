import { HitAreaEngine } from './interaction/hit-area-engine';
import { InteractionRecognizer } from './interaction/interaction-recognizer';
import { InteractionRuleEngine } from './interaction/interaction-rule-engine';
import { InteractionExecutor, ExecutorCallbacks } from './interaction/interaction-executor';
import { InteractionDebugOverlay } from './interaction/interaction-debug-overlay';
import { InteractionManifest, InteractionEventType, InteractionAction, InteractionExecutionContext } from './interaction/interaction-types';
import { PetSettings } from '../shared/pet-settings';
import { DialogueDirector } from './natural/dialogue-director';
import { ReactionSession } from './natural/reaction-session';
import { resolveInteractionAnimation } from './interaction/resolve-interaction-animation';
import { HitAreaShape } from './interaction/interaction-types';
import { isCanvasPointOpaque } from './interaction/visual-alpha-hit-test';

export interface InteractionControllerCallbacks {
  playAnimation: (animName: string, fallback?: string, context?: InteractionExecutionContext) => boolean | void;
  showDialogue: (text: string, context?: InteractionExecutionContext) => void;
  resetBehaviorTimer: () => void;
  cancelMotion: () => void;
  setFacing: (facing: "left" | "right") => void;
  getRandomDialogueFromGroup: (group: string) => string | null;
  getCurrentState: () => string;
  getCurrentAction?: () => string | null;
  getFacing: () => "left" | "right";
  hasAnimation: (name: string) => boolean;
  onDragStart: (
    initialDirection: "left" | "right" | null,
    pointerScreenX: number,
    pointerScreenY: number
  ) => void;
  onDragMove: (pointerScreenX: number, pointerScreenY: number) => void;
  onDragEnd: (reason?: string) => void;
  onPressVisualStart: () => void;
  onPressVisualCancel: () => void;
  onStrokeReaction?: (areaId: string | null) => void;
  onHoverReaction?: (areaId: string | null) => void;
}

export class InteractionController {
  private element: HTMLElement;
  private spriteImg: HTMLImageElement;
  private debugOverlayDiv: HTMLDivElement;
  
  private recognizer: InteractionRecognizer;
  private hitAreaEngine: HitAreaEngine;
  private ruleEngine: InteractionRuleEngine;
  private executor: InteractionExecutor;
  private debugOverlay: InteractionDebugOverlay;
  private dialogueDirector: DialogueDirector;
  private activeReactionSession: ReactionSession | null = null;

  private callbacks: InteractionControllerCallbacks;
  private settings: PetSettings;
  private manifest: InteractionManifest | null = null;

  private lastHoverTime: number = 0;
  private currentHoverArea: string | null = null;
  private interactionConfigLogged = false;
  private forceDialogueInDev = import.meta.env.DEV && import.meta.env.VITE_FORCE_DIALOGUE_IN_DEV === 'true';

  constructor(
    element: HTMLElement,
    spriteImg: HTMLImageElement,
    debugOverlayDiv: HTMLDivElement,
    settings: PetSettings,
    callbacks: InteractionControllerCallbacks
  ) {
    this.element = element;
    this.spriteImg = spriteImg;
    this.debugOverlayDiv = debugOverlayDiv;
    this.settings = settings;
    this.callbacks = callbacks;
    this.dialogueDirector = new DialogueDirector();

    this.hitAreaEngine = new HitAreaEngine(undefined, true);
    this.ruleEngine = new InteractionRuleEngine();
    
    const executorCallbacks: ExecutorCallbacks = {
      playAnimation: (animName, fallback, context) => {
        const stateBefore = this.callbacks.getCurrentState();
        const accepted = this.callbacks.playAnimation(animName, fallback, context);
        if (import.meta.env.DEV) {
          console.info(
            `[interaction-action] event=${context.event} requested=${animName} accepted=${accepted !== false} ` +
            `stateBefore=${stateBefore} currentPriority=${this.callbacks.getCurrentAction?.() ?? 'none'} ` +
            `${accepted === false ? `blockedBy=${this.callbacks.getCurrentAction?.() ?? 'none'}` : ''}`
          );
        }
        return accepted;
      },
      showDialogue: (text, context) => this.showDialogueForContext(text, context),
      resetBehaviorTimer: this.callbacks.resetBehaviorTimer,
      cancelMotion: this.callbacks.cancelMotion,
      setFacing: this.callbacks.setFacing,
      getRandomDialogueFromGroup: this.callbacks.getRandomDialogueFromGroup
    };
    this.executor = new InteractionExecutor(executorCallbacks);

    this.debugOverlay = new InteractionDebugOverlay(this.debugOverlayDiv, this.spriteImg, this.hitAreaEngine);
    this.debugOverlay.setEnabled(this.settings.hitAreaDebugEnabled);

    this.recognizer = new InteractionRecognizer(this.element, {
      findArea: (clientX, clientY) => {
        const spriteRect = this.getVisualInteractionRect();
        const facing = this.callbacks.getFacing();
        const area = this.findHitAreaAtPoint(clientX, clientY, spriteRect, facing);
        if (import.meta.env.DEV) {
          console.info(
            `[interaction-trace]\n` +
            `phase=pointerdown\n` +
            `x=${clientX}\n` +
            `y=${clientY}\n` +
            `rect=${spriteRect.left},${spriteRect.top},${spriteRect.width},${spriteRect.height}\n` +
            `area=${area?.id ?? 'none'}\n` +
            `enabled=${this.settings.interactionEnabled}`
          );
        }
        this.debugOverlay.updatePointerInfo(clientX, clientY, area ? area.id : null);
        return area ? {
          id: area.id,
          draggable: area.draggable,
          interactionRole: (area as any).interactionRole,
          acceptsStroke: (area as any).acceptsStroke
        } : null;
      },
      onEvent: (event, areaId, _clientX, _clientY) => {
        const currentState = this.callbacks.getCurrentState();
        
        if (currentState === 'sleep') {
          this.debugOverlay.updateEventInfo(event, "wake-from-sleep");
          this.callbacks.playAnimation("wake", "idle");
          this.callbacks.resetBehaviorTimer();
          return;
        }

        if (currentState === 'falling' || currentState === 'landing') {
          this.debugOverlay.updateEventInfo(event, "ignored-during-physics");
          return;
        }

        if (currentState === 'walk' || currentState === 'sit') {
          this.callbacks.cancelMotion();
        }

        const rule = this.ruleEngine.matchRule(event, areaId, currentState, this.manifest);
        
        console.log(`[interaction] recognized event=${event} area=${areaId} state=${currentState} -> rule=${rule ? rule.id : 'fallback'}`);
        if (import.meta.env.DEV) {
          console.info(
            `[interaction-trace]\n` +
            `event=${event}\n` +
            `rule=${rule?.id ?? 'fallback'}`
          );
        }
        
        this.debugOverlay.updateEventInfo(event, rule ? rule.id : 'fallback');

        if (rule) {
          this.executor.executeActions(rule.actions, this.toExecutionContext(event, areaId));
        } else {
          this.executeFallback(event, areaId);
        }
      },
      onStrokeStart: (areaId) => {
        if (!this.activeReactionSession) {
          this.activeReactionSession = new ReactionSession(
            areaId === "head" ? "touch-head" : "touch-body"
          );
          if (this.callbacks.onStrokeReaction) {
            this.callbacks.onStrokeReaction(areaId);
          }
        }
        const context: InteractionExecutionContext = { event: "stroke", areaId };
        if (this.dialogueDirector.shouldShowDialogue("stroke", this.settings, performance.now(), this.forceDialogueInDev)) {
          const dialogue = this.callbacks.getRandomDialogueFromGroup("headTouch") || "♪(･ω･)ﾉ";
          this.callbacks.showDialogue(dialogue, context);
          this.dialogueDirector.recordDialogueShown();
          if (import.meta.env.DEV) console.info('[dialogue] event=stroke group=headTouch allowed=true textFound=true');
        } else if (import.meta.env.DEV) {
          console.info('[dialogue] event=stroke group=headTouch allowed=false textFound=false');
        }
      },
      onStrokeProgress: (_areaId) => {
        if (this.activeReactionSession) {
          this.activeReactionSession.extend();
        }
      },
      onStrokeEnd: (_areaId) => {
        if (this.activeReactionSession) {
          this.activeReactionSession.finish("strokeEnd");
          this.activeReactionSession = null;
        }
        this.dialogueDirector.resetStrokeDialogueState();
      },
      onDragStart: (areaId, initialDirection, pointerScreenX, pointerScreenY) => {
        this.callbacks.onDragStart(initialDirection, pointerScreenX, pointerScreenY);
        this.debugOverlay.updateEventInfo("dragStart", `area:${areaId};direction:${initialDirection ?? "vertical"}`);
      },
      onDragMove: (pointerScreenX, pointerScreenY) => {
        this.callbacks.onDragMove(pointerScreenX, pointerScreenY);
      },
      onDragEnd: (areaId, reason) => {
        this.activeReactionSession?.finish("dragEnd");
        this.activeReactionSession = null;
        this.dialogueDirector.resetStrokeDialogueState();
        this.callbacks.onDragEnd(reason);
        this.debugOverlay.updateEventInfo("dragEnd", `area:${areaId};reason:${reason ?? "unknown"}`);
      },
      isInteractionEnabled: () => {
        return this.settings.interactionEnabled;
      },
      isDragEnabled: () => {
        return true;
      },
      isAdvancedPettingEnabled: () => {
        return this.settings.interactionStyle === "advanced-petting";
      },
      onPressStart: () => {
        this.callbacks.onPressVisualStart();
      },
      onPressCancel: () => {
        this.callbacks.onPressVisualCancel();
      }
    });

    this.element.addEventListener('pointermove', this.handlePointerMoveHover);
  }

  private handlePointerMoveHover = (e: PointerEvent) => {
    if (!this.settings.interactionEnabled) return;

    const spriteRect = this.getVisualInteractionRect();
    const facing = this.callbacks.getFacing();
    const area = this.findHitAreaAtPoint(e.clientX, e.clientY, spriteRect, facing);
    this.element.classList.toggle('is-interactive-hover', area !== null);

    if (this.settings.hitAreaDebugEnabled) {
      this.debugOverlay.updatePointerInfo(e.clientX, e.clientY, area ? area.id : null);
    }

    const now = performance.now();
    const areaId = area ? area.id : null;

    if (areaId !== this.currentHoverArea) {
      this.currentHoverArea = areaId;

      // 仅在首次进入区域且达到 2000ms 冷却时响应
      if (areaId && now - this.lastHoverTime >= 2000) {
        this.lastHoverTime = now;
        const currentState = this.callbacks.getCurrentState();

        if (currentState === "idle" || currentState === "sit") {
          // 20% 概率触发低频轻微 hover 反应
          if (Math.random() < 0.20 && this.callbacks.onHoverReaction) {
            console.log(`[hover] triggered on area=${areaId}`);
            this.callbacks.onHoverReaction(areaId);
          }
        }
      }
    }
  };

  public updateSettings(settings: PetSettings) {
    this.settings = settings;
    this.debugOverlay.setEnabled(settings.hitAreaDebugEnabled);
  }

  /** Development-only manual acceptance switch; never persisted in settings. */
  public setForceDialogueInDev(enabled: boolean) {
    this.forceDialogueInDev = import.meta.env.DEV && enabled;
  }

  public updateCharacterContext(
    manifest: InteractionManifest | null,
    _dialogues: any,
    supportsHorizontalFlip: boolean
  ) {
    this.manifest = manifest;
    
    this.hitAreaEngine = new HitAreaEngine(manifest?.hitAreas, supportsHorizontalFlip);
    this.ruleEngine.clearCooldowns();
    this.debugOverlay.updateEngine(this.hitAreaEngine);

    if (import.meta.env.DEV && !this.interactionConfigLogged) {
      const visualSurface = this.element.querySelector('.codex-frame-viewport')
        ? 'codex-frame-viewport'
        : 'pet-sprite';
      console.info(
        `[interaction-config]\n` +
        `enabled=${this.settings.interactionEnabled}\n` +
        `style=${this.settings.interactionStyle}\n` +
        `hitAreas=${this.hitAreaEngine.getHitAreas().length}\n` +
        `visualSurface=${visualSurface}`
      );
      this.interactionConfigLogged = true;
    }
  }

  private getVisualInteractionRect(): DOMRect {
    const codexViewport = this.element.querySelector<HTMLElement>(
      '.codex-frame-viewport'
    );

    if (codexViewport) {
      return codexViewport.getBoundingClientRect();
    }

    return this.spriteImg.getBoundingClientRect();
  }

  private findHitAreaAtPoint(
    clientX: number,
    clientY: number,
    spriteRect: DOMRect,
    facing: "left" | "right",
  ): HitAreaShape | null {
    const codexCanvas = this.element.querySelector<HTMLCanvasElement>(
      'canvas.codex-frame-canvas'
    );
    if (codexCanvas && !isCanvasPointOpaque(codexCanvas, clientX, clientY, spriteRect)) {
      return null;
    }
    return this.hitAreaEngine.findHitArea(clientX, clientY, spriteRect, facing);
  }

  private executeFallback(event: InteractionEventType, areaId: string | null) {
    let animation = "";
    let dialogueGroup = "";

    const fallbackRule = this.manifest?.fallbackRules?.[event];
    if (fallbackRule) {
      animation = fallbackRule.animation || "";
      dialogueGroup = fallbackRule.dialogueGroup || "";
    } else {
      switch (event) {
        case "singleClick":
          animation = resolveInteractionAnimation("singleClick", this.callbacks.hasAnimation);
          dialogueGroup = "singleClick";
          break;
        case "doubleClick":
          animation = resolveInteractionAnimation("doubleClick", this.callbacks.hasAnimation);
          dialogueGroup = "doubleClick";
          break;
        case "rapidClick":
          animation = resolveInteractionAnimation("rapidClick", this.callbacks.hasAnimation);
          dialogueGroup = "rapidClick";
          break;
        case "longPress":
          animation = resolveInteractionAnimation("longPress", this.callbacks.hasAnimation);
          dialogueGroup = "longPress";
          break;
      }
    }

    const actions: InteractionAction[] = [];
    if (animation) {
      actions.push({ type: "playAnimation", animation, fallback: "idle" });
    }
    if (dialogueGroup) {
      actions.push({ type: "showDialogue", group: dialogueGroup });
    }
    actions.push({ type: "resetBehaviorTimer" });
    
    if (actions.length > 0) {
      this.executor.executeActions(actions, this.toExecutionContext(event, areaId));
    }
  }

  private toExecutionContext(event: InteractionEventType, areaId: string | null): InteractionExecutionContext {
    const supported: InteractionExecutionContext['event'][] = [
      'singleClick', 'doubleClick', 'rapidClick', 'longPress', 'stroke'
    ];
    return {
      event: supported.includes(event as InteractionExecutionContext['event'])
        ? event as InteractionExecutionContext['event']
        : 'singleClick',
      areaId
    };
  }

  private showDialogueForContext(text: string, context: InteractionExecutionContext) {
    const intent = ({
      singleClick: 'tap',
      doubleClick: 'doubleTap',
      rapidClick: 'rapidTap',
      longPress: 'longPress',
      stroke: 'stroke'
    } as const)[context.event];
    const allowed = this.dialogueDirector.shouldShowDialogue(
      intent,
      this.settings,
      performance.now(),
      this.forceDialogueInDev
    );
    if (import.meta.env.DEV) {
      console.info(
        `[dialogue] event=${context.event} group=${context.dialogueGroup ?? context.event} allowed=${allowed} textFound=${Boolean(text.trim())}`
      );
    }
    if (allowed && text.trim()) {
      this.callbacks.showDialogue(text, context);
      this.dialogueDirector.recordDialogueShown();
    }
  }

  public destroy() {
    this.recognizer.unbindEvents();
    this.element.removeEventListener('pointermove', this.handlePointerMoveHover);
    this.debugOverlay.setEnabled(false);
    this.element.classList.remove('is-interactive-hover');
  }
}
