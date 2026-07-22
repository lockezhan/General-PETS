import { HitAreaEngine } from './interaction/hit-area-engine';
import { InteractionRecognizer } from './interaction/interaction-recognizer';
import { InteractionRuleEngine } from './interaction/interaction-rule-engine';
import { InteractionExecutor, ExecutorCallbacks } from './interaction/interaction-executor';
import { InteractionDebugOverlay } from './interaction/interaction-debug-overlay';
import { InteractionManifest, InteractionEventType, InteractionAction } from './interaction/interaction-types';
import { PetSettings } from '../shared/pet-settings';
import { DialogueDirector } from './natural/dialogue-director';
import { ReactionSession } from './natural/reaction-session';

export interface InteractionControllerCallbacks {
  playAnimation: (animName: string, fallback?: string) => void;
  showDialogue: (text: string) => void;
  resetBehaviorTimer: () => void;
  cancelMotion: () => void;
  setFacing: (facing: "left" | "right") => void;
  getRandomDialogueFromGroup: (group: string) => string | null;
  getCurrentState: () => string;
  getFacing: () => "left" | "right";
  onDragStart: (initialDirection: "left" | "right" | null) => void;
  onDragEnd: () => void;
  onPressVisualStart: () => void;
  onPressVisualCancel: () => void;
  onStrokeReaction?: (areaId: string | null) => void;
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
      playAnimation: this.callbacks.playAnimation,
      showDialogue: (text) => {
        if (this.dialogueDirector.shouldShowDialogue("tap", this.settings)) {
          this.callbacks.showDialogue(text);
          this.dialogueDirector.recordDialogueShown();
        }
      },
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
        let spriteRect = this.spriteImg.getBoundingClientRect();
        if (spriteRect.width === 0 || spriteRect.height === 0) {
          const viewport = this.element.querySelector('.codex-frame-viewport') || this.element;
          spriteRect = viewport.getBoundingClientRect();
        }
        const facing = this.callbacks.getFacing();
        const area = this.hitAreaEngine.findHitArea(clientX, clientY, spriteRect, facing);
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

        // 抚摸特规逻辑：使用 ReactionSession 避免重置帧
        if (event === "stroke") {
          if (!this.activeReactionSession) {
            this.activeReactionSession = new ReactionSession(
              areaId === "head" ? "touch-head" : "touch-body"
            );
            if (this.callbacks.onStrokeReaction) {
              this.callbacks.onStrokeReaction(areaId);
            }
          } else {
            this.activeReactionSession.extend();
          }

          if (this.dialogueDirector.shouldShowDialogue("stroke", this.settings)) {
            const dialogue = this.callbacks.getRandomDialogueFromGroup("headTouch") || "♪(･ω･)ﾉ";
            this.callbacks.showDialogue(dialogue);
            this.dialogueDirector.recordDialogueShown();
          }
          return;
        }

        const rule = this.ruleEngine.matchRule(event, areaId, currentState, this.manifest);
        
        console.log(`[interaction] recognized event=${event} area=${areaId} state=${currentState} -> rule=${rule ? rule.id : 'fallback'}`);
        
        this.debugOverlay.updateEventInfo(event, rule ? rule.id : 'fallback');

        if (rule) {
          this.executor.executeActions(rule.actions);
        } else {
          this.executeFallback(event);
        }
      },
      onDragStart: (areaId, initialDirection) => {
        this.callbacks.onDragStart(initialDirection);
        this.debugOverlay.updateEventInfo("dragStart", `area:${areaId};direction:${initialDirection ?? "vertical"}`);
      },
      onDragEnd: (areaId) => {
        this.activeReactionSession?.finish("dragEnd");
        this.activeReactionSession = null;
        this.dialogueDirector.resetStrokeDialogueState();
        this.callbacks.onDragEnd();
        this.debugOverlay.updateEventInfo("dragEnd", `area:${areaId}`);
      },
      isInteractionEnabled: () => {
        return this.settings.interactionEnabled;
      },
      isDragEnabled: () => {
        return true;
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
    if (!this.settings.hitAreaDebugEnabled) return;
    if (!this.settings.interactionEnabled) return;
    
    const spriteRect = this.spriteImg.getBoundingClientRect();
    const facing = this.callbacks.getFacing();
    const area = this.hitAreaEngine.findHitArea(e.clientX, e.clientY, spriteRect, facing);
    this.debugOverlay.updatePointerInfo(e.clientX, e.clientY, area ? area.id : null);
  };

  public updateSettings(settings: PetSettings) {
    this.settings = settings;
    this.debugOverlay.setEnabled(settings.hitAreaDebugEnabled);
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
  }

  private executeFallback(event: InteractionEventType) {
    let animation = "";
    let dialogueGroup = "";

    const fallbackRule = this.manifest?.fallbackRules?.[event];
    if (fallbackRule) {
      animation = fallbackRule.animation || "";
      dialogueGroup = fallbackRule.dialogueGroup || "";
    } else {
      switch (event) {
        case "singleClick":
          animation = "happy";
          dialogueGroup = "singleClick";
          break;
        case "doubleClick":
          animation = "happy";
          dialogueGroup = "doubleClick";
          break;
        case "rapidClick":
          animation = "angry";
          dialogueGroup = "rapidClick";
          break;
        case "longPress":
          animation = "happy";
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
    
    this.executor.executeActions(actions);
  }

  public destroy() {
    this.recognizer.unbindEvents();
    this.element.removeEventListener('pointermove', this.handlePointerMoveHover);
    this.debugOverlay.setEnabled(false);
  }
}
