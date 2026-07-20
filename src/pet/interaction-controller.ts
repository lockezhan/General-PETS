import { HitAreaEngine } from './interaction/hit-area-engine';
import { InteractionRecognizer } from './interaction/interaction-recognizer';
import { InteractionRuleEngine } from './interaction/interaction-rule-engine';
import { InteractionExecutor, ExecutorCallbacks } from './interaction/interaction-executor';
import { InteractionDebugOverlay } from './interaction/interaction-debug-overlay';
import { InteractionManifest, InteractionEventType, InteractionAction } from './interaction/interaction-types';
import { PetSettings } from '../shared/pet-settings';

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

    // Initialize engines
    this.hitAreaEngine = new HitAreaEngine(undefined, true);
    this.ruleEngine = new InteractionRuleEngine();
    
    const executorCallbacks: ExecutorCallbacks = {
      playAnimation: this.callbacks.playAnimation,
      showDialogue: this.callbacks.showDialogue,
      resetBehaviorTimer: this.callbacks.resetBehaviorTimer,
      cancelMotion: this.callbacks.cancelMotion,
      setFacing: this.callbacks.setFacing,
      getRandomDialogueFromGroup: this.callbacks.getRandomDialogueFromGroup
    };
    this.executor = new InteractionExecutor(executorCallbacks);

    this.debugOverlay = new InteractionDebugOverlay(this.debugOverlayDiv, this.spriteImg, this.hitAreaEngine);
    this.debugOverlay.setEnabled(this.settings.hitAreaDebugEnabled);

    // Initialize recognizer
    this.recognizer = new InteractionRecognizer(this.element, {
      findArea: (clientX, clientY) => {
        const spriteRect = this.spriteImg.getBoundingClientRect();
        const facing = this.callbacks.getFacing();
        const area = this.hitAreaEngine.findHitArea(clientX, clientY, spriteRect, facing);
        this.debugOverlay.updatePointerInfo(clientX, clientY, area ? area.id : null);
        return area;
      },
      onEvent: (event, areaId, _clientX, _clientY) => {
        const currentState = this.callbacks.getCurrentState();
        
        // Handle special state restrictions before executing rules
        if (currentState === 'sleep') {
          // Any interaction wakes up the pet
          this.debugOverlay.updateEventInfo(event, "wake-from-sleep");
          this.callbacks.playAnimation("wake", "idle");
          this.callbacks.resetBehaviorTimer();
          return;
        }

        if (currentState === 'falling' || currentState === 'landing') {
          // Falling/landing does not respond to regular clicks
          this.debugOverlay.updateEventInfo(event, "ignored-during-physics");
          return;
        }

        // Cancel motion for sit/walk when clicked
        if (currentState === 'walk' || currentState === 'sit') {
          this.callbacks.cancelMotion();
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

    // Handle extra mousemove on the element itself for live debug coords updating when not mouse down
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
