import { CharacterLoader } from './character-loader';
import { resolveDirectionalAnimation, HorizontalDirection } from './render/directional-animation-resolver';
import { AnimationRenderer } from './render/animation-renderer';
import { FrameSequenceRenderer } from './render/frame-sequence-renderer';
import { CodexAtlasRenderer } from './render/codex-atlas-renderer';
import { InteractionController, InteractionControllerCallbacks } from './interaction-controller';
import { PetState, CharacterManifest, DEFAULT_MOTION_CONFIG, MotionConfig } from '../shared/character-types';
import { PetSettings } from '../shared/pet-settings';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { EVENT_SETTINGS_CHANGED, EVENT_RESET_POSITION, EVENT_TEST_WALK, EVENT_TEST_FALL } from '../shared/event-names';
import { currentMonitor, primaryMonitor, availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { load } from '@tauri-apps/plugin-store';
import { convertFileSrc } from '@tauri-apps/api/core';

import { PetStateMachine } from './pet-state-machine';
import { FacingController } from './facing-controller';
import { FloorController } from './floor-controller';
import { MotionController, MotionProgress } from './motion-controller';
import { InteractionManifest, InteractionExecutionContext } from './interaction/interaction-types';
import { validateInteractions } from './character-validator';
import { DEFAULT_CODEX_HIT_AREAS, BehaviorContext } from './natural/natural-types';
import { DialogueDirector, getDialogueDurationMs } from './natural/dialogue-director';
import { ActionDirector } from './natural/action-director';
import { BehaviorPlanner, PlannedBehavior } from './natural/behavior-planner';
import { PetVisualCoordinator } from './natural/visual-coordinator';
import { resolveInteractionAnimation } from './interaction/resolve-interaction-animation';
import { calculatePetVisualLayout } from './visual-layout';
import { migratePetSettings } from '../shared/settings-migration';
import { ManualWindowDragController, ManualDragProgress, ManualDragSummary } from './manual-window-drag-controller';
import { getAmbientDialogueProbability, getAmbientPresentation, getInteractionPresentation, randomDuration } from './natural/action-presentation-profiles';

export const GAIT_TEST_DISTANCE_LOGICAL_PX = 288;
export const GAIT_CALIBRATION_STRIDES = [48, 60, 72, 84, 96, 120] as const;

export interface WalkDebugSnapshot {
  requestId: number;
  reason: "test" | "autonomous" | "onEdge" | "manual-drag";
  requestedDirection: "left" | "right";
  stateBefore: string;
  stateAccepted: boolean;
  characterId: string;
  sourceKind: "builtin" | "installed";
  logicalAnimation: string;
  adapterKey: string | null;
  mappedCodexAnimation: string | null;
  atlasRow: number | null;
  logicalFacing: "left" | "right";
  cssFacing: "left" | "right";
  viewportTransform: string;
  velocityX: number | null;
}

export const DEFAULT_CODEX_LOCOMOTION = {
  walkStrideLengthPx: 72,
  dragStrideLengthPx: 72,
  runStrideLengthPx: 88,
  walkFrameCount: 8,
  runFrameCount: 6,
};

export class PetController {
  private loader: CharacterLoader;
  private player!: AnimationRenderer;
  private interaction: InteractionController;
  
  private petRoot: HTMLDivElement;
  private petStage: HTMLDivElement;
  private petFacingLayer: HTMLDivElement;
  private petImage: HTMLImageElement;
  private bubble: HTMLDivElement;
  private debugOverlayDiv: HTMLDivElement;
  
  private stateMachine: PetStateMachine;
  private facingController: FacingController;
  private floorController: FloorController;
  private motionController: MotionController;
  
  private visualCoordinator: PetVisualCoordinator;
  private actionDirector!: ActionDirector;
  private behaviorPlanner: BehaviorPlanner;

  private bubbleTimer: number | null = null;
  private sleepTimer: number | null = null;
  private sitTimer: number | null = null;
  
  private manualDragController: ManualWindowDragController;
  private settings: PetSettings = { ...DEFAULT_SETTINGS };
  private dialogues: any = null;
  private defaultDialogues: any = null;
  private ambientDialogueDirector = new DialogueDirector();
  private lastAmbientDialogueAt = Number.NEGATIVE_INFINITY;
  private ambientDialogueCooldownMs = 0;
  private activeAmbientAction: PlannedBehavior['logicalAction'] | null = null;
  private interactionManifest: InteractionManifest | null = null;

  private isDraggingWindow = false;
  private walkRequestId = 0;
  private activeDragSessionId = 0;
  private completedDragSessionId = 0;
  private dragSlowSince: number | null = null;
  private dragCurrentAnimation: string | null = null;
  private dragWaitingTimer: number | null = null;

  constructor() {
    this.loader = new CharacterLoader('default');
    
    this.petRoot = document.createElement('div');
    this.petRoot.className = 'pet-root';
    
    this.petStage = document.createElement('div');
    this.petStage.className = 'pet-stage';
    
    this.petFacingLayer = document.createElement('div');
    this.petFacingLayer.className = 'pet-facing-layer';

    this.petImage = document.createElement('img');
    this.petImage.className = 'pet-sprite';
    this.petImage.draggable = false;
    
    this.petFacingLayer.appendChild(this.petImage);
    this.petStage.appendChild(this.petFacingLayer);
    
    this.bubble = document.createElement('div');
    this.bubble.className = 'speech-bubble';
    const bubbleText = document.createElement('div');
    bubbleText.className = 'speech-bubble__text';
    this.bubble.appendChild(bubbleText);

    this.debugOverlayDiv = document.createElement('div');
    this.debugOverlayDiv.className = 'interaction-debug-overlay';
    this.petStage.appendChild(this.debugOverlayDiv);
    
    this.petRoot.appendChild(this.bubble);
    this.petRoot.appendChild(this.petStage);
    
    const app = document.getElementById('app');
    if (app) {
      app.appendChild(this.petRoot);
    }

    this.visualCoordinator = new PetVisualCoordinator();
    this.behaviorPlanner = new BehaviorPlanner((plan) => {
      this.handleBehaviorPlan(plan);
    });

    this.recreateRenderer();
    
    this.stateMachine = new PetStateMachine();
    this.facingController = new FacingController(this.petFacingLayer);
    this.floorController = new FloorController();
    this.motionController = new MotionController();

    this.manualDragController = new ManualWindowDragController(
      (progress) => this.handleManualDragProgress(progress)
    );

    const interactionCallbacks: InteractionControllerCallbacks = {
      playAnimation: (animName, fallback, context) => {
        return this.playCustomAnimation(animName, fallback, context);
      },
      showDialogue: (text) => {
        this.showBubble(text);
      },
      resetBehaviorTimer: () => {
        this.behaviorPlanner.recordUserInteraction();
      },
      cancelMotion: () => {
        this.cancelActiveLocomotion("user interaction");
      },
      setFacing: (facing) => {
        this.facingController.setFacing(facing);
        this.player?.setFacing?.(facing);
      },
      getRandomDialogueFromGroup: (group) => {
        return this.getRandomDialogueFromGroup(group);
      },
      getCurrentState: () => {
        return this.stateMachine.getState();
      },
      getCurrentAction: () => this.actionDirector?.getCurrentActionLabel() ?? null,
      getFacing: () => {
        return this.facingController.getFacing();
      },
      hasAnimation: (name) => {
        return this.player?.hasAnimation(name) ?? false;
      },
      onDragStart: (initialDirection, pointerScreenX, pointerScreenY) => {
        this.handleManualDragStart(initialDirection, pointerScreenX, pointerScreenY);
      },
      onDragMove: (pointerScreenX, pointerScreenY) => {
        this.manualDragController.update(pointerScreenX, pointerScreenY);
      },
      onDragEnd: (reason) => {
        void this.finishManualDrag(this.activeDragSessionId, reason ?? 'pointerup');
      },
      onPressVisualStart: () => {
        this.petRoot.classList.add('is-pressed');
      },
      onPressVisualCancel: () => {
        this.petRoot.classList.remove('is-pressed');
      },
      onStrokeReaction: () => {
        this.playCustomAnimation('waving', 'idle');
      },
      onHoverReaction: () => {
        this.playCustomAnimation('review', 'idle');
      }
    };

    this.interaction = new InteractionController(
      this.petRoot,
      this.petImage,
      this.debugOverlayDiv,
      this.settings,
      interactionCallbacks
    );

    listen<boolean>("window-visibility-changed", (event) => {
      const visible = event.payload;
      if (!visible) {
        console.log("[pet] window hidden, pausing motion/scheduler");
        this.motionController.cancelActiveMotion("window hidden");
        this.behaviorPlanner.cancel("window hidden");
      } else {
        console.log("[pet] window shown, rescheduling");
        this.floorController.invalidateCache();
        this.behaviorPlanner.cancel("window shown reset");
        this.startIdleTimers();
      }
    });

    listen(EVENT_RESET_POSITION, () => {
      console.log("[pet-controller] received EVENT_RESET_POSITION");
      this.floorController.invalidateCache();
      void this.movePetToDefaultPosition();
    });

    listen(EVENT_SETTINGS_CHANGED, async (e: any) => {
      console.log("[pet-controller] received EVENT_SETTINGS_CHANGED:", e.payload);
      this.floorController.invalidateCache();
      await this.applySettings(e.payload);
    });

    listen<{ direction?: unknown }>(EVENT_TEST_WALK, (event) => {
      console.log("[pet-controller] received EVENT_TEST_WALK:", event.payload);
      const direction = event.payload?.direction;
      if (direction !== "left" && direction !== "right") {
        return;
      }
      this.cancelActiveLocomotion("test-walk");
      this.beginDirectionalWalk(direction, 6000, "test");
    });

    listen(EVENT_TEST_FALL, async () => {
      console.log("[pet-controller] received EVENT_TEST_FALL");
      await this.startIntentionalFall("test-fall");
    });

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openSettingsWindow();
    });
  }

  public async init() {
    try {
      const store = await load('settings.json', { autoSave: true });
      const savedSettings = await store.get<Partial<PetSettings>>('pet-settings');
      const migration = migratePetSettings(savedSettings);
      this.settings = migration.settings;
      if (savedSettings) {
        if (migration.interactionEnabledAdded) {
          await store.set('pet-settings', this.settings);
        }
      }
    } catch (e) {
      console.error("[pet-controller] failed to load store", e);
    }

    this.interaction.updateSettings(this.settings);

    this.loader = new CharacterLoader(this.settings.characterId);

    try {
      await this.loader.load();
      this.recreateRenderer();
      await this.player.load();
      await this.loadDialogues(this.settings.characterId);
      await this.loadInteractions(this.settings.characterId);
    } catch (e) {
      console.error("Failed to load initial character:", e);
    }

    try {
      await this.applySettings(this.settings);
    } catch (e) {
      console.error("Failed to apply settings during init:", e);
    }

    this.trySetState('idle');

    try {
      await this.checkInitialPosition();
      this.startIdleTimers();
    } catch (e) {
      console.error("Failed to check initial position:", e);
    }

    try {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
    } catch (e) {
      console.error("Failed to show window:", e);
    }
  }

  private recreateRenderer() {
    if (this.player) {
      this.player.destroy();
    }
    const source = this.loader.getCharacterSource();
    if (source && source.kind === 'installed') {
      const rootUrl = convertFileSrc(source.rootPath);
      const manifest = this.loader.getConfig();
      const spritesheetUrl = `${rootUrl}/${manifest?.spritesheetPath || 'spritesheet.webp'}`;
      this.player = new CodexAtlasRenderer(this.petImage, spritesheetUrl, this.loader.getAdapterConfig()!);
    } else {
      this.player = new FrameSequenceRenderer(this.loader, this.petImage);
    }
    this.player.updateSpeedMultiplier?.(this.settings.animationSpeedMultiplier);

    if (!this.actionDirector) {
      this.actionDirector = new ActionDirector(this.player);
    } else {
      this.actionDirector.setRenderer(this.player);
    }
  }

  public async applySettings(newSettings: PetSettings) {
    console.log("[pet-controller] applySettings called with characterId:", newSettings.characterId);
    this.floorController.invalidateCache();
    const characterChanged = this.settings.characterId !== newSettings.characterId;

    if (characterChanged) {
      this.motionController.cancelActiveMotion("character changed");
      this.actionDirector.clearCurrentAction("character changed");
      this.loader = new CharacterLoader(newSettings.characterId);
      try {
        await this.loader.load();
        this.recreateRenderer();
        await this.player.load();
        await this.loadDialogues(newSettings.characterId);
        await this.loadInteractions(newSettings.characterId);
        this.trySetState('idle');
      } catch (e) {
        console.error("Failed to load new character:", e);
      }
    } else if (!this.dialogues) {
      await this.loadDialogues(newSettings.characterId);
    }

    this.settings = newSettings;

    if (this.player && this.player.updateSpeedMultiplier) {
      this.player.updateSpeedMultiplier(this.settings.animationSpeedMultiplier);
    }

    this.interaction.updateSettings(this.settings);

    if (characterChanged) {
      const motionConfig = this.getMotionConfig();
      const source = this.loader.getCharacterSource();
      const isCodex = source && source.kind === 'installed';
      this.interaction.updateCharacterContext(
        this.interactionManifest,
        this.dialogues,
        isCodex ? false : motionConfig.supportsHorizontalFlip
      );
    }

    const manifest = this.loader.getConfig();
    if (manifest) {
      await this.resizePetWindowForCharacter(manifest, this.settings.scale);
    }

    await getCurrentWindow().setAlwaysOnTop(this.settings.alwaysOnTop);

    if (!this.settings.autoMovementEnabled && this.stateMachine.getState() === 'walk') {
      this.motionController.cancelActiveMotion("settings autoMovement off");
      this.trySetState('idle');
    }
    this.startIdleTimers();
  }

  private async loadDialogues(_characterId: string) {
    this.defaultDialogues = null;
    try {
      const defaultRes = await fetch('/characters/default/dialogues.json');
      if (defaultRes.ok) {
        this.defaultDialogues = await defaultRes.json();
      }
    } catch (e) {
      console.warn('Failed to load default dialogues:', e);
    }

    try {
      const source = this.loader.getCharacterSource();
      if (source && source.kind === 'installed') {
        const customDialogues = this.loader.getDialogues();
        if (customDialogues) {
          this.dialogues = customDialogues;
          console.log("[dialogues] Loaded custom dialogues from loader cache");
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to load custom dialogues, falling back to default:", e);
    }

    this.dialogues = this.defaultDialogues;
  }

  private async loadInteractions(characterId: string) {
    this.interactionManifest = null;
    const source = this.loader.getCharacterSource();

    if (source && source.kind === 'installed') {
      try {
        const customInteractions = this.loader.getInteractions();
        if (customInteractions) {
          if (validateInteractions(customInteractions)) {
            this.interactionManifest = customInteractions;
            console.log(`[interactions] Loaded installed interactions.json from loader cache`);
          }
        }
      } catch (e) {
        console.warn(`[interactions] Failed to load custom interactions:`, e);
      }
    } else {
      try {
        const res = await fetch(`/characters/${characterId}/interactions.json`);
        if (res.ok) {
          const json = await res.json();
          if (validateInteractions(json)) {
            this.interactionManifest = json;
          }
        }
      } catch (e) {
        console.warn(`[interactions] Failed to load built-in interactions.json:`, e);
      }
    }

    if (!this.interactionManifest) {
      const singleClickAnimation = resolveInteractionAnimation(
        "singleClick",
        (name) => this.player.hasAnimation(name)
      );
      const doubleClickAnimation = resolveInteractionAnimation(
        "doubleClick",
        (name) => this.player.hasAnimation(name)
      );
      const rapidClickAnimation = resolveInteractionAnimation(
        "rapidClick",
        (name) => this.player.hasAnimation(name)
      );
      const longPressAnimation = resolveInteractionAnimation(
        "longPress",
        (name) => this.player.hasAnimation(name)
      );

      this.interactionManifest = {
        schemaVersion: 1,
        hitAreas: DEFAULT_CODEX_HIT_AREAS as any,
        rules: [
          {
            id: "click-waving",
            event: "singleClick",
            area: "*",
            priority: 10,
            actions: [
              { type: "playAnimation", animation: singleClickAnimation, fallback: "idle" },
              { type: "showDialogue", group: "singleClick" }
            ]
          },
          {
            id: "double-jumping",
            event: "doubleClick",
            area: "*",
            priority: 20,
            actions: [
              { type: "playAnimation", animation: doubleClickAnimation, fallback: "idle" },
              { type: "showDialogue", group: "doubleClick" }
            ]
          },
          {
            id: "rapid-failed",
            event: "rapidClick",
            area: "*",
            priority: 30,
            actions: [
              { type: "playAnimation", animation: rapidClickAnimation, fallback: "idle" },
              { type: "showDialogue", group: "rapidClick" }
            ]
          },
          {
            id: "longpress-review",
            event: "longPress",
            area: "*",
            priority: 25,
            actions: [
              { type: "playAnimation", animation: longPressAnimation, fallback: "idle" },
              { type: "showDialogue", group: "longPress" }
            ]
          }
        ]
      };
    }

    const motionConfig = this.getMotionConfig();
    const isCodex = source && source.kind === 'installed';
    this.interaction.updateCharacterContext(
      this.interactionManifest,
      this.dialogues,
      isCodex ? false : motionConfig.supportsHorizontalFlip
    );
  }

  private handleBehaviorPlan(plan: PlannedBehavior) {
    if (this.stateMachine.getState() !== 'idle' || this.isDraggingWindow) return;
    this.clearTimers();

    if (plan.logicalAction === 'walk' && plan.targetDirection) {
      this.beginDirectionalWalk(plan.targetDirection, plan.durationMs || 5000, "autonomous");
      return;
    }

    const anim = this.resolveAmbientAnimation(plan.logicalAction) ?? 'idle';
    const presentation = getAmbientPresentation(anim);
    const isTimedLoop = plan.logicalAction === 'idle' || plan.logicalAction === 'sit' || plan.logicalAction === 'run';
    this.visualCoordinator.setReactionState(anim as any, 'ambient');
    const accepted = this.actionDirector.requestAction({
      id: plan.id,
      animation: anim,
      priority: 'ambient',
      source: 'behavior',
      loop: isTimedLoop ? true : presentation.loop,
      repeatCount: presentation.repeatCount,
      minimumVisibleMs: presentation.minimumVisibleMs,
      holdAfterMs: presentation.holdAfterMs,
      onComplete: isTimedLoop ? undefined : () => {
        this.completeAmbientBehavior(plan.logicalAction, `behavior ${anim} completed`);
      }
    });
    if (!accepted) {
      this.startIdleTimers();
      return;
    }

    this.activeAmbientAction = plan.logicalAction;
    this.behaviorPlanner.recordActionStarted(plan.logicalAction);
    this.tryShowAmbientDialogue(plan.logicalAction);

    if (isTimedLoop) {
      const durationMs = plan.logicalAction === 'idle'
        ? (plan.durationMs ?? randomDuration({ min: 3000, max: 6000 }))
        : randomDuration(presentation.durationRangeMs ?? { min: 3000, max: 5000 });
      this.sitTimer = window.setTimeout(() => {
        this.sitTimer = null;
        this.completeAmbientBehavior(plan.logicalAction, `timed behavior ${anim} completed`);
      }, durationMs);
    }
  }

  private completeAmbientBehavior(logicalAction: PlannedBehavior['logicalAction'], reason: string): void {
    if (this.activeAmbientAction === logicalAction) this.activeAmbientAction = null;
    this.behaviorPlanner.recordActionCompleted(logicalAction);
    if (!this.isDraggingWindow && this.stateMachine.getState() !== 'falling' && this.stateMachine.getState() !== 'landing') {
      this.requestIdleVisual(reason);
    }
  }

  private cancelAmbientBehavior(reason: string): void {
    if (this.activeAmbientAction) {
      this.behaviorPlanner.recordActionCompleted(this.activeAmbientAction);
      this.activeAmbientAction = null;
    }
    this.clearTimers();
    if (import.meta.env.DEV) console.info(`[ambient] cancelled reason=${reason}`);
  }

  private tryShowAmbientDialogue(logicalAction: PlannedBehavior['logicalAction']): void {
    if (!['wave', 'review', 'sit', 'hop'].includes(logicalAction)) return;
    if (this.isDraggingWindow || this.stateMachine.getState() !== 'idle') return;
    if (this.behaviorPlanner.getTimeSinceLastUserInteraction() < 8000) return;

    const now = performance.now();
    if (now - this.lastAmbientDialogueAt < this.ambientDialogueCooldownMs) return;
    const probability = getAmbientDialogueProbability(this.settings.dialogueFrequency, logicalAction);
    const allowed = this.ambientDialogueDirector.shouldShowDialogue(
      'ambient',
      { ...this.settings, dialogueFrequency: 'normal' },
      now,
      false,
      probability
    );
    if (!allowed) return;

    const preferredGroup = logicalAction === 'wave' || logicalAction === 'review'
      ? logicalAction
      : 'idle';
    const text = this.getRandomDialogueFromGroup(preferredGroup)
      ?? (preferredGroup === 'idle' ? null : this.getRandomDialogueFromGroup('idle'));
    if (!text) return;
    this.showBubble(text);
    this.ambientDialogueDirector.recordDialogueShown(now);
    this.lastAmbientDialogueAt = now;
    this.ambientDialogueCooldownMs = 25000 + Math.random() * 20000;
  }

  public playCustomAnimation(
    animName: string,
    fallback: string = 'idle',
    _context?: InteractionExecutionContext
  ): boolean {
    this.behaviorPlanner.recordUserInteraction();
    this.cancelAmbientBehavior('user animation request');
    this.cancelActiveLocomotion("user animation request");
    this.visualCoordinator.setReactionState(animName as any, "user");

    const isLongPressReview = animName === 'review';
    const presentation = getInteractionPresentation(animName);
    const stateBefore = this.stateMachine.getState();
    const accepted = this.actionDirector.requestAction({
      id: isLongPressReview
        ? `longpress-review-${Date.now()}`
        : `custom-${animName}-${Date.now()}`,
      animation: animName,
      priority: 'interaction',
      source: 'user',
      fallback: isLongPressReview ? 'idle' : fallback,
      interruptPolicy: isLongPressReview ? 'immediate' : 'extend-same',
      loop: presentation.loop ?? false,
      repeatCount: presentation.repeatCount,
      minimumVisibleMs: presentation.minimumVisibleMs,
      holdAfterMs: presentation.holdAfterMs,
      onComplete: () => {
        if (!this.isDraggingWindow && this.stateMachine.getState() !== 'falling' && this.stateMachine.getState() !== 'landing') {
          this.requestIdleVisual(`animation ${animName} completed`);
        }
      }
    });

    if (isLongPressReview && import.meta.env.DEV) {
      console.info(
        `[longpress]\n` +
        `threshold=650\n` +
        `event-committed=true\n` +
        `requested=review\n` +
        `mapped=review\n` +
        `row=8\n` +
        `loop=false\n` +
        `fallback=idle`
      );
    }
    if (import.meta.env.DEV) {
      console.info(`[interaction-action] event=${_context?.event ?? 'direct'} requested=${animName} accepted=${accepted} stateBefore=${stateBefore} currentPriority=${this.actionDirector.getCurrentActionLabel() ?? 'none'}`);
    }
    return accepted;
  }

  private playStateAnimation(state: PetState) {
    if (state === 'idle') {
      this.requestIdleVisual('state transition');
      return;
    }
    if (state === 'landing') {
      this.enterLandingAfterFall();
      return;
    }
    const isSystemState = state === 'falling' || state === 'landing';
    const isLocomotionState = state === 'walk' || state === 'dragged';
    const priority = isSystemState ? 'system' : (isLocomotionState ? 'locomotion' : 'ambient');

    if (state === 'walk') {
      this.visualCoordinator.setMotionState('walk-right');
    } else if (state === 'dragged') {
      this.visualCoordinator.setMotionState('drag-static');
    } else if (state === 'falling') {
      this.visualCoordinator.setMotionState('falling');
    } else if (state === 'idle') {
      this.visualCoordinator.setMotionState('idle');
      this.visualCoordinator.setReactionState('idle', 'ambient');
    }

    this.actionDirector.requestAction({
      id: `state-${state}-${Date.now()}`,
      animation: state === 'sit' ? 'waiting' : (state === 'dragged' ? 'waiting' : state),
      priority,
      source: 'system',
      fallback: undefined,
      loop: state === 'falling'
    });
  }

  private requestIdleVisual(reason: string): void {
    this.actionDirector.clearCurrentAction(`enter idle: ${reason}`);
    this.visualCoordinator.clearMotionState(reason);
    this.visualCoordinator.setReactionState('idle', 'ambient');
    this.stateMachine.forceState('idle');
    this.actionDirector.requestAction({
      id: `idle-${Date.now()}`,
      animation: 'idle',
      priority: 'ambient',
      source: 'behavior',
      loop: true
    });
    this.startIdleTimers();
  }

  private enterLandingAfterFall(): void {
    this.stateMachine.forceState('landing');
    this.visualCoordinator.setMotionState('landing');
    this.actionDirector.clearCurrentAction('fall completed');

    if (!this.player.hasAnimation('landing')) {
      this.requestIdleVisual('landing animation unavailable');
      return;
    }

    this.actionDirector.requestAction({
      id: `landing-${Date.now()}`,
      animation: 'landing',
      priority: 'system',
      source: 'system',
      loop: false,
      onComplete: () => {
        this.requestIdleVisual('landing completed');
      }
    });
  }

  private async startIntentionalFall(reason: string): Promise<void> {
    this.cancelAmbientBehavior(reason);
    this.cancelActiveLocomotion(reason);
    this.actionDirector.clearCurrentAction(reason);
    const floorInfo = await this.floorController.getCurrentFloorInfo();
    if (!floorInfo) {
      this.requestIdleVisual('fall floor unavailable');
      return;
    }
    this.stateMachine.forceState('falling');
    this.visualCoordinator.setMotionState('falling');
    this.actionDirector.requestAction({
      id: `falling-${Date.now()}`,
      animation: 'falling',
      priority: 'system',
      source: 'system',
      loop: true
    });
    await this.motionController.startFall(floorInfo, this.settings, () => {
      this.enterLandingAfterFall();
    });
  }

  private cancelActiveLocomotion(reason: string) {
    this.walkRequestId++;
    this.motionController.cancelActiveMotion(reason);
    this.visualCoordinator.clearMotionState(reason);
    this.player?.endDistanceDriven?.();
  }

  private async beginDirectionalWalk(
    direction: "left" | "right",
    durationMs: number,
    reason: "test" | "autonomous" | "onEdge",
    ambientSession: boolean = reason === 'autonomous'
  ) {
    if (this.isDraggingWindow) return;
    if (reason !== 'onEdge') this.clearTimers();

    this.walkRequestId++;
    const currentWalkId = this.walkRequestId;

    const floorInfo = await this.floorController.getCurrentFloorInfo();
    if (!floorInfo) {
      this.startIdleTimers();
      return;
    }

    const config = this.getMotionConfig();
    const speed = config.walkSpeed;
    const locomotion = this.getLocomotionProfile();
    const effectiveDurationMs = reason === 'test' && import.meta.env.DEV
      ? (GAIT_TEST_DISTANCE_LOGICAL_PX / Math.max(1, speed * this.settings.walkSpeedMultiplier)) * 1000
      : durationMs;
    const source = this.loader.getCharacterSource();
    const res = resolveDirectionalAnimation(source, direction, (name) => this.player.hasAnimation(name));

    this.facingController.setFacing(res.facing, res.useFacingMirror ? config.supportsHorizontalFlip : false);
    this.player.setFacing?.(res.facing);
    this.visualCoordinator.setMotionState(direction === 'left' ? 'walk-left' : 'walk-right');

    this.player.beginDistanceDriven({
      animation: res.animation,
      frameCount: 8,
      strideLengthPx: locomotion.walkStrideLengthPx
    });

    this.stateMachine.forceState('walk');
    if (reason === 'autonomous') {
      this.activeAmbientAction = 'walk';
      this.behaviorPlanner.recordActionStarted('walk');
    }
    let committedDistance = 0;
    let commitCount = 0;

    this.motionController.startWalk(
      speed,
      direction,
      effectiveDurationMs,
      floorInfo,
      this.settings,
      () => {
        if (currentWalkId !== this.walkRequestId) return;
        if (this.settings.edgeBehavior === 'turn') {
          const newDir = direction === 'left' ? 'right' : 'left';
          this.beginDirectionalWalk(newDir, durationMs, "onEdge", ambientSession);
        } else {
          this.cancelActiveLocomotion("hit edge stop");
          if (ambientSession) this.completeAmbientBehavior('walk', 'walk hit edge');
          else this.trySetState('idle');
        }
      },
      () => {
        if (currentWalkId !== this.walkRequestId) return;
        if (reason === 'test' && import.meta.env.DEV) {
          console.info(
            `[gait-calibration] planned=${GAIT_TEST_DISTANCE_LOGICAL_PX} committed=${committedDistance.toFixed(1)} ` +
            `stride=${locomotion.walkStrideLengthPx} cycles=${(committedDistance / locomotion.walkStrideLengthPx).toFixed(2)} commits=${commitCount}`
          );
        }
        this.cancelActiveLocomotion("walk complete");
        if (ambientSession) this.completeAmbientBehavior('walk', 'walk completed');
        else this.trySetState('idle');
      },
      (progress: MotionProgress) => {
        if (currentWalkId !== this.walkRequestId) return;
        committedDistance = progress.totalLogicalDistance;
        commitCount = progress.commitCount;
        this.player.updateDistanceDriven(progress.totalLogicalDistance);
      }
    );
  }

  private handleManualDragStart(
    initialDirection: "left" | "right" | null,
    pointerScreenX: number,
    pointerScreenY: number
  ) {
    const sessionId = ++this.activeDragSessionId;
    this.isDraggingWindow = true;
    this.petRoot.classList.remove('is-pressed');
    this.floorController.invalidateCache();
    this.cancelActiveLocomotion("manual drag start");
    this.actionDirector.clearCurrentAction("manual drag start");
    this.cancelAmbientBehavior("manual drag start");
    this.behaviorPlanner.recordUserInteraction();
    this.stateMachine.forceState('dragged');
    this.visualCoordinator.setMotionState('drag-static');
    this.dragSlowSince = null;
    this.dragCurrentAnimation = null;
    this.clearDragWaitingTimer();

    void this.manualDragController.begin(pointerScreenX, pointerScreenY).then(async () => {
      if (!this.isDraggingWindow || sessionId !== this.activeDragSessionId) return;
      const floorInfo = await this.floorController.getCurrentFloorInfo();
      if (import.meta.env.DEV) {
        console.info(
          `[manual-drag]\n` +
          `session=${sessionId}\n` +
          `phase=start\n` +
          `startWindow=${floorInfo ? `${floorInfo.workAreaLeft},${floorInfo.floorWindowY}` : 'unknown'}\n` +
          `startPointer=${pointerScreenX},${pointerScreenY}\n` +
          `floorY=${floorInfo?.floorWindowY ?? 'unknown'}`
        );
      }
      if (initialDirection) {
        this.setManualDragAnimation(initialDirection, 0);
      }
    });
  }

  private handleManualDragProgress(progress: ManualDragProgress) {
    if (this.stateMachine.getState() !== 'dragged' || !this.isDraggingWindow) return;

    const now = performance.now();
    const predominantlyVertical =
      Math.abs(progress.totalLogicalY) > Math.abs(progress.totalLogicalX) * 1.15;
    let animation: string | null = null;

    if (predominantlyVertical) {
      this.dragSlowSince = null;
      this.clearDragWaitingTimer();
      animation = Math.abs(progress.velocityY) >= 60 ? 'jumping' : 'waiting';
      this.visualCoordinator.setMotionState(
        animation === 'jumping' ? 'drag-vertical' : 'drag-static'
      );
    } else if (Math.abs(progress.velocityX) >= 60 && progress.direction) {
      this.dragSlowSince = null;
      this.clearDragWaitingTimer();
      animation = progress.direction === 'left' ? 'running-left' : 'running-right';
      this.visualCoordinator.setMotionState(
        progress.direction === 'left' ? 'drag-left' : 'drag-right'
      );
    } else if (Math.abs(progress.velocityX) < 35) {
      this.dragSlowSince ??= now;
      this.scheduleDragWaiting();
      if (now - this.dragSlowSince >= 160) {
        animation = 'waiting';
        this.visualCoordinator.setMotionState('drag-static');
      }
    } else {
      this.dragSlowSince = null;
      this.clearDragWaitingTimer();
      animation = this.dragCurrentAnimation;
    }

    if (animation === 'running-left' || animation === 'running-right') {
      this.setManualDragAnimation(
        animation === 'running-left' ? 'left' : 'right',
        progress.totalHorizontalDistance
      );
    } else if (animation && animation !== this.dragCurrentAnimation) {
      this.player.endDistanceDriven();
      this.actionDirector.requestAction({
        id: `drag-${animation}`,
        animation,
        priority: 'locomotion',
        source: 'user',
        interruptPolicy: 'extend-same',
        fallback: 'idle'
      });
      this.dragCurrentAnimation = animation;
    }

    if (import.meta.env.DEV) {
      console.info(
        `[manual-drag]\n` +
        `session=${this.activeDragSessionId}\n` +
        `phase=progress\n` +
        `dx=${progress.totalLogicalX.toFixed(1)}\n` +
        `dy=${progress.totalLogicalY.toFixed(1)}\n` +
        `vx=${progress.velocityX.toFixed(1)}\n` +
        `vy=${progress.velocityY.toFixed(1)}\n` +
        `direction=${progress.direction ?? 'none'}\n` +
        `animation=${animation ?? this.dragCurrentAnimation ?? 'none'}`
      );
    }
  }

  private setManualDragAnimation(direction: HorizontalDirection, totalDistance: number) {
    if (!this.isDraggingWindow) return;
    const config = this.getMotionConfig();
    const source = this.loader.getCharacterSource();
    const res = resolveDirectionalAnimation(source, direction, (name) => this.player.hasAnimation(name));

    if (this.player.getCurrentAnimation() !== res.animation) {
      this.facingController.setFacing(
        res.facing,
        res.useFacingMirror ? config.supportsHorizontalFlip : false
      );
      this.player.setFacing?.(res.facing);
      this.player.beginDistanceDriven({
        animation: res.animation,
        frameCount: 8,
        strideLengthPx: this.getLocomotionProfile().dragStrideLengthPx
      });
    }
    this.dragCurrentAnimation = direction === 'left' ? 'running-left' : 'running-right';
    this.player.updateDistanceDriven(totalDistance);
  }

  private scheduleDragWaiting() {
    if (this.dragWaitingTimer !== null) return;
    this.dragWaitingTimer = window.setTimeout(() => {
      this.dragWaitingTimer = null;
      if (!this.isDraggingWindow || this.dragSlowSince === null) return;
      if (performance.now() - this.dragSlowSince >= 160) {
        this.player.endDistanceDriven();
        this.actionDirector.requestAction({
          id: 'drag-waiting',
          animation: 'waiting',
          priority: 'locomotion',
          source: 'user',
          interruptPolicy: 'extend-same',
          fallback: 'idle'
        });
        this.dragCurrentAnimation = 'waiting';
        this.visualCoordinator.setMotionState('drag-static');
      }
    }, 160);
  }

  private clearDragWaitingTimer() {
    if (this.dragWaitingTimer !== null) {
      clearTimeout(this.dragWaitingTimer);
      this.dragWaitingTimer = null;
    }
  }

  private async finishManualDrag(sessionId: number, reason: string) {
    if (
      sessionId !== this.activeDragSessionId ||
      sessionId === this.completedDragSessionId
    ) {
      return;
    }

    this.completedDragSessionId = sessionId;
    this.isDraggingWindow = false;
    this.clearDragWaitingTimer();
    this.petRoot.classList.remove('is-pressed');
    this.floorController.invalidateCache();

    const summary: ManualDragSummary = await this.manualDragController.end(reason);
    this.player.endDistanceDriven();

    if (import.meta.env.DEV) {
      console.info(
        `[manual-drag]\n` +
        `session=${sessionId}\n` +
        `phase=end\n` +
        `reason=${reason}\n` +
          `endPhysical=${summary.endPhysicalX},${summary.endPhysicalY}\n` +
          `lift=${summary.maximumUpwardLiftLogical.toFixed(1)}\n` +
          `vertical=${summary.predominantlyVertical}\n` +
          `willFall=false`
      );
    }

    // ManualWindowDragController.end() has already flushed the final
    // physical position. A normal drag is a free placement operation: keep
    // both X and Y and never reinterpret the gesture as gravity.
    this.actionDirector.clearCurrentAction('manual drag ended');
    this.visualCoordinator.clearMotionState('manual drag placed freely');
    this.stateMachine.forceState('idle');
    this.requestIdleVisual('manual drag placed freely');
  }

  public showBubble(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return;
    if (this.bubbleTimer !== null) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }

    let bubbleText = this.bubble.querySelector<HTMLElement>('.speech-bubble__text');
    if (!bubbleText) {
      bubbleText = document.createElement('div');
      bubbleText.className = 'speech-bubble__text';
      this.bubble.appendChild(bubbleText);
    }
    bubbleText.textContent = cleanText;
    this.bubble.style.pointerEvents = 'none';
    this.bubble.classList.add('is-visible');

    const durationMs = getDialogueDurationMs(cleanText);
    if (import.meta.env.DEV) {
      requestAnimationFrame(() => {
        const styles = getComputedStyle(this.bubble);
        console.info(
          `[bubble] textLength=${cleanText.length} visibleClass=${this.bubble.classList.contains('is-visible')} ` +
          `opacity=${styles.opacity} visibility=${styles.visibility} durationMs=${durationMs}`
        );
      });
    }
    this.bubbleTimer = window.setTimeout(() => {
      this.bubble.classList.remove('is-visible');
      this.bubbleTimer = null;
    }, durationMs);
  }

  private startIdleTimers() {
    this.clearTimers();
    if (this.stateMachine.getState() !== 'idle') return;
    const history = this.behaviorPlanner.getHistory();
    const context: BehaviorContext = {
      idleDurationMs: 0,
      sinceLastUserInteractionMs: this.behaviorPlanner.getTimeSinceLastUserInteraction(),
      lastActionId: history.lastActionId,
      recentActions: history.recentActions,
      facing: this.facingController.getFacing(),
      nearLeftEdge: false,
      nearRightEdge: false,
      currentHour: new Date().getHours()
    };
    const availableActions = [
      'idle',
      ...(this.settings.autoMovementEnabled ? ['walk'] : []),
      ...(this.resolveAmbientAnimation('sit') ? ['sit'] : []),
      ...(this.resolveAmbientAnimation('wave') ? ['wave'] : []),
      ...(this.resolveAmbientAnimation('review') ? ['review'] : []),
      ...(this.resolveAmbientAnimation('hop') ? ['hop'] : []),
      ...(this.settings.autoMovementEnabled && this.resolveAmbientAnimation('run') ? ['run'] : [])
    ];
    this.behaviorPlanner.scheduleNext(this.settings, context, availableActions);
    
    if (this.settings.sleepEnabled) {
      const sleepDelay = this.settings.sleepDelayMinutes * 60 * 1000;
      this.sleepTimer = window.setTimeout(() => {
        if (this.stateMachine.getState() === 'idle') {
          this.trySetState('sleep');
        }
      }, sleepDelay);
    }
  }

  private clearTimers() {
    this.behaviorPlanner?.cancel('clearTimers');
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    if (this.sitTimer) {
      clearTimeout(this.sitTimer);
      this.sitTimer = null;
    }
  }

  private trySetState(nextState: PetState): boolean {
    const ok = this.stateMachine.setState(nextState);
    if (ok) {
      this.playStateAnimation(nextState);
    }
    return ok;
  }

  private getMotionConfig(): MotionConfig {
    const manifest = this.loader.getConfig();
    if (manifest && manifest.motion) {
      return { ...DEFAULT_MOTION_CONFIG, ...manifest.motion };
    }
    return DEFAULT_MOTION_CONFIG;
  }

  private getLocomotionProfile() {
    const configured = this.loader.getAdapterConfig()?.locomotion;
    const profile = { ...DEFAULT_CODEX_LOCOMOTION, ...(configured ?? {}) };
    if (import.meta.env.DEV) {
      const requested = Number(import.meta.env.VITE_GAIT_STRIDE);
      if (GAIT_CALIBRATION_STRIDES.includes(requested as typeof GAIT_CALIBRATION_STRIDES[number])) {
        profile.walkStrideLengthPx = requested;
      }
    }
    return profile;
  }

  private resolveAmbientAnimation(logicalAction: PlannedBehavior['logicalAction']): string | null {
    switch (logicalAction) {
      case 'idle':
        return this.player.hasAnimation('idle') ? 'idle' : null;
      case 'sit':
        return this.player.hasAnimation('waiting') ? 'waiting'
          : this.player.hasAnimation('sit') ? 'sit' : null;
      case 'wave':
        return resolveInteractionAnimation('singleClick', (name) => this.player.hasAnimation(name));
      case 'review':
        return resolveInteractionAnimation('longPress', (name) => this.player.hasAnimation(name));
      case 'hop':
        return resolveInteractionAnimation('doubleClick', (name) => this.player.hasAnimation(name));
      case 'run':
        return this.player.hasAnimation('running') ? 'running' : null;
      default:
        return null;
    }
  }

  private getRandomDialogueFromGroup(group: string): string | null {
    const builtin: Record<string, string> = {
      singleClick: '你好呀！',
      doubleClick: '又见面啦！',
      rapidClick: '不要一直戳我！',
      longPress: '我知道你还没松手。'
    };
    const sources: Array<{ name: 'character' | 'default' | 'builtin'; data: any }> = [
      { name: 'character', data: this.dialogues },
      { name: 'default', data: this.defaultDialogues }
    ];
    let text: string | null = null;
    let source: 'character' | 'default' | 'builtin' = 'builtin';
    for (const candidate of sources) {
      const list = candidate.data?.[group];
      if (!Array.isArray(list) || list.length === 0) continue;
      const item = list[Math.floor(Math.random() * list.length)];
      text = typeof item === 'string' ? item : item?.text;
      if (text) {
        source = candidate.name;
        break;
      }
    }
    const fallbackGroup = !text
      ? (group.includes('singleClick') ? 'singleClick'
        : group.includes('doubleClick') ? 'doubleClick'
        : group.includes('rapidClick') ? 'rapidClick'
        : group.includes('longPress') ? 'longPress'
        : null)
      : null;
    if (!text && fallbackGroup && builtin[fallbackGroup]) {
      text = builtin[fallbackGroup];
      source = 'builtin';
    }
    if (import.meta.env.DEV) {
      console.info(`[dialogue] event=${group} group=${group} source=${source} textFound=${Boolean(text)}`);
    }
    return text;
  }

  private async checkInitialPosition() {
    const firstRunDone = localStorage.getItem('first_run_done');
    if (!firstRunDone) {
      await this.movePetToDefaultPosition();
      localStorage.setItem('first_run_done', 'true');
      return;
    }

    await this.clampPetWindowToVisibleArea();
  }

  private async movePetToDefaultPosition() {
    this.floorController.invalidateCache();
    const floorInfo = await this.floorController.getCurrentFloorInfo();
    if (!floorInfo) return;

    const appWindow = getCurrentWindow();
    const size = await appWindow.outerSize();
    const centerX = floorInfo.workAreaLeft + Math.round(
      (floorInfo.workAreaRight - floorInfo.workAreaLeft - size.width) / 2
    );
    await appWindow.setPosition(
      new PhysicalPosition(centerX, floorInfo.floorWindowY)
    );
  }

  private async resizePetWindowForCharacter(manifest: CharacterManifest, scale: number): Promise<void> {
    this.floorController.invalidateCache();
    const frameW = manifest.render?.width || 192;
    const frameH = manifest.render?.height || 208;
    const {
      stageWidth: stageW,
      stageHeight: stageH,
      windowWidth: winW,
      windowHeight: winH
    } = calculatePetVisualLayout(frameW, frameH, scale);

    if (this.player?.resize) {
      this.player.resize(stageW, stageH);
    } else {
      this.petImage.style.width = `${stageW}px`;
      this.petImage.style.height = `${stageH}px`;
      this.petImage.style.transform = 'none';
      this.petImage.style.objectFit = 'contain';
      this.petImage.style.objectPosition = 'center bottom';
      this.petImage.style.transformOrigin = 'center bottom';
    }

    document.documentElement.style.setProperty(
      '--pet-display-height',
      `${stageH}px`
    );

    this.petStage.style.width = `${stageW}px`;
    this.petStage.style.height = `${stageH}px`;

    const appWindow = getCurrentWindow();
    const oldPosition = await appWindow.outerPosition();
    const oldSize = await appWindow.outerSize();

    await appWindow.setSize(new LogicalSize(winW, winH));

    const scaleFactor = await appWindow.scaleFactor();
    const newPhysicalWidth = Math.round(winW * scaleFactor);
    const newPhysicalHeight = Math.round(winH * scaleFactor);

    const nextX = oldPosition.x + Math.round(
      (oldSize.width - newPhysicalWidth) / 2
    );
    const nextY = oldPosition.y + oldSize.height - newPhysicalHeight;

    await appWindow.setPosition(new PhysicalPosition(nextX, nextY));
    await this.clampPetWindowToVisibleArea();

    if (import.meta.env.DEV) {
      const viewport = this.petRoot.querySelector<HTMLElement>('.codex-frame-viewport');
      const canvas = this.petRoot.querySelector<HTMLCanvasElement>('.codex-frame-canvas');
      console.info(
        `[visual-resize]\n` +
        `scale=${scale}\n` +
        `frame=${frameW}x${frameH}\n` +
        `stage=${stageW}x${stageH}\n` +
        `viewport=${viewport?.style.width ?? 'n/a'}x${viewport?.style.height ?? 'n/a'}\n` +
        `canvasCss=${canvas?.style.width ?? 'n/a'}x${canvas?.style.height ?? 'n/a'}\n` +
        `canvasPhysical=${canvas ? `${canvas.width}x${canvas.height}` : 'n/a'}\n` +
        `window=${winW}x${winH}`
      );
    }
  }

  private async clampPetWindowToVisibleArea(): Promise<void> {
    try {
      const appWindow = getCurrentWindow();
      const currentPosition = await appWindow.outerPosition();
      const windowSize = await appWindow.outerSize();
      const monitors = await availableMonitors();
      const intersectsMonitor = monitors.some((monitor) => {
        const left = monitor.workArea.position.x;
        const top = monitor.workArea.position.y;
        const right = left + monitor.workArea.size.width;
        const bottom = top + monitor.workArea.size.height;
        return currentPosition.x < right && currentPosition.x + windowSize.width > left &&
          currentPosition.y < bottom && currentPosition.y + windowSize.height > top;
      });
      if (!intersectsMonitor && monitors.length > 0) {
        await this.movePetToDefaultPosition();
        return;
      }

      const monitor = await currentMonitor() ?? await primaryMonitor();
      if (!monitor) return;

      const { position, size } = monitor.workArea;
      const minX = position.x;
      const minY = position.y;
      const maxX = Math.max(minX, position.x + size.width - windowSize.width);
      const maxY = Math.max(minY, position.y + size.height - windowSize.height);
      const nextX = Math.max(minX, Math.min(currentPosition.x, maxX));
      const nextY = Math.max(minY, Math.min(currentPosition.y, maxY));

      if (nextX !== currentPosition.x || nextY !== currentPosition.y) {
        await appWindow.setPosition(new PhysicalPosition(nextX, nextY));
      }
    } catch (error) {
      console.error('[pet] Failed to clamp window to visible work area:', error);
    }
  }

  private async openSettingsWindow() {
    try {
      const existing = await WebviewWindow.getByLabel('settings');
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
      new WebviewWindow('settings', {
        url: 'settings/index.html',
        title: 'General-PETS Settings',
        width: 600,
        height: 500,
        resizable: false,
        alwaysOnTop: true,
        decorations: true
      });
    } catch (e) {
      console.error('[pet] Failed to open settings window:', e);
    }
  }
}
