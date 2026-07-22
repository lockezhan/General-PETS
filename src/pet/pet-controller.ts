import { CharacterLoader } from './character-loader';
import { DragDirectionTracker, DragProgress } from './drag-direction-tracker';
import { resolveDirectionalAnimation, HorizontalDirection } from './render/directional-animation-resolver';
import { AnimationRenderer } from './render/animation-renderer';
import { FrameSequenceRenderer } from './render/frame-sequence-renderer';
import { CodexAtlasRenderer } from './render/codex-atlas-renderer';
import { InteractionController, InteractionControllerCallbacks } from './interaction-controller';
import { PetState, CharacterManifest, DEFAULT_MOTION_CONFIG, MotionConfig } from '../shared/character-types';
import { PetSettings } from '../shared/pet-settings';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { EVENT_SETTINGS_CHANGED, EVENT_RESET_POSITION, EVENT_TEST_WALK, EVENT_TEST_FALL } from '../shared/event-names';
import { primaryMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { load } from '@tauri-apps/plugin-store';
import { convertFileSrc } from '@tauri-apps/api/core';

import { PetStateMachine } from './pet-state-machine';
import { FacingController } from './facing-controller';
import { FloorController } from './floor-controller';
import { MotionController, MotionProgress } from './motion-controller';
import { InteractionManifest } from './interaction/interaction-types';
import { validateInteractions } from './character-validator';
import { DEFAULT_CODEX_HIT_AREAS, BehaviorContext } from './natural/natural-types';
import { getDialogueDurationMs } from './natural/dialogue-director';
import { ActionDirector } from './natural/action-director';
import { BehaviorPlanner, PlannedBehavior } from './natural/behavior-planner';
import { PetVisualCoordinator } from './natural/visual-coordinator';
import { DragPoseController } from './natural/drag-pose-controller';

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
  walkStrideLengthPx: 120,
  runStrideLengthPx: 144,
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
  private dragPoseController: DragPoseController;

  private bubbleTimer: number | null = null;
  private sleepTimer: number | null = null;
  private sitTimer: number | null = null;
  
  private dragDirectionTracker!: DragDirectionTracker;
  private settings: PetSettings = { ...DEFAULT_SETTINGS };
  private dialogues: any = null;
  private interactionManifest: InteractionManifest | null = null;

  private isDraggingWindow = false;
  private dragAnimTimer: number | null = null;
  private walkRequestId = 0;

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
    this.dragPoseController = new DragPoseController();

    this.behaviorPlanner = new BehaviorPlanner((plan) => {
      this.handleBehaviorPlan(plan);
    });

    this.recreateRenderer();
    
    this.stateMachine = new PetStateMachine();
    this.facingController = new FacingController(this.petFacingLayer);
    this.floorController = new FloorController();
    this.motionController = new MotionController();

    this.dragDirectionTracker = new DragDirectionTracker(
      (dir) => {
        this.updateManualDragDirection(dir);
      },
      (progress) => {
        this.handleManualDragProgress(progress);
      }
    );

    const interactionCallbacks: InteractionControllerCallbacks = {
      playAnimation: (animName, fallback) => {
        this.playCustomAnimation(animName, fallback);
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
      getFacing: () => {
        return this.facingController.getFacing();
      },
      onDragStart: (initialDirection) => {
        this.handleManualDragStart(initialDirection);
      },
      onDragEnd: () => {
        this.handleDragRelease();
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
      this.movePetToDefaultPosition();
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
      this.cancelActiveLocomotion("test-fall");
      const floorInfo = await this.floorController.getCurrentFloorInfo();
      if (floorInfo && this.trySetState('falling')) {
        this.motionController.startFall(floorInfo, this.settings, () => {
          this.trySetState('landing');
        });
      }
    });

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.openSettingsWindow();
    });
  }

  public async init() {
    try {
      const store = await load('settings.json', { autoSave: true });
      const savedSettings = await store.get<PetSettings>('pet-settings');
      if (savedSettings) {
        this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
      }
    } catch (e) {
      console.error("[pet-controller] failed to load store", e);
    }

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

    try {
      const res = await fetch(`/characters/default/dialogues.json`);
      if (res.ok) {
        this.dialogues = await res.json();
      }
    } catch (e) {
      console.error("Failed to load default dialogues", e);
    }
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
              { type: "playAnimation", animation: "waving", fallback: "idle" },
              { type: "showDialogue", group: "singleClick" }
            ]
          },
          {
            id: "double-jumping",
            event: "doubleClick",
            area: "*",
            priority: 20,
            actions: [
              { type: "playAnimation", animation: "jumping", fallback: "idle" },
              { type: "showDialogue", group: "doubleClick" }
            ]
          },
          {
            id: "rapid-failed",
            event: "rapidClick",
            area: "*",
            priority: 30,
            actions: [
              { type: "playAnimation", animation: "failed", fallback: "idle" },
              { type: "showDialogue", group: "rapidClick" }
            ]
          },
          {
            id: "longpress-review",
            event: "longPress",
            area: "*",
            priority: 25,
            actions: [
              { type: "playAnimation", animation: "review", fallback: "idle" },
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

    if (plan.logicalAction === 'walk' && plan.targetDirection) {
      this.beginDirectionalWalk(plan.targetDirection, plan.durationMs || 5000, "autonomous");
    } else {
      const animMap: Record<string, string> = {
        wave: 'waving',
        review: 'review',
        sit: 'waiting',
        hop: 'jumping',
        run: 'running',
        idle: 'idle'
      };
      const anim = animMap[plan.logicalAction] || 'idle';
      this.visualCoordinator.setReactionState(anim as any, "ambient");
      this.actionDirector.requestAction({
        id: plan.id,
        animation: anim,
        priority: 'ambient',
        source: 'behavior',
        fallback: 'idle'
      });
    }

    this.startIdleTimers();
  }

  public playCustomAnimation(animName: string, fallback: string = 'idle') {
    this.behaviorPlanner.recordUserInteraction();
    this.cancelActiveLocomotion("user animation request");
    this.visualCoordinator.setReactionState(animName as any, "user");

    this.actionDirector.requestAction({
      id: `custom-${animName}-${Date.now()}`,
      animation: animName,
      priority: 'interaction',
      source: 'user',
      fallback,
      interruptPolicy: 'extend-same'
    });
  }

  private playStateAnimation(state: PetState) {
    const isSystemState = state === 'falling' || state === 'landing';
    const isLocomotionState = state === 'walk' || state === 'dragged';
    const priority = isSystemState ? 'system' : (isLocomotionState ? 'locomotion' : 'ambient');

    if (state === 'walk') {
      this.visualCoordinator.setMotionState('walk-right');
    } else if (state === 'dragged') {
      this.visualCoordinator.setMotionState('drag-static');
    } else if (state === 'falling') {
      this.visualCoordinator.setMotionState('falling');
    } else if (state === 'landing') {
      this.visualCoordinator.setMotionState('landing');
    } else if (state === 'idle') {
      this.visualCoordinator.setMotionState('idle');
      this.visualCoordinator.setReactionState('idle', 'ambient');
    }

    this.actionDirector.requestAction({
      id: `state-${state}-${Date.now()}`,
      animation: state === 'sit' ? 'waiting' : (state === 'dragged' ? 'waiting' : state),
      priority,
      source: 'system',
      fallback: 'idle'
    });

    if (state === 'idle') {
      this.startIdleTimers();
    }
  }

  private cancelActiveLocomotion(reason: string) {
    this.walkRequestId++;
    this.motionController.cancelActiveMotion(reason);
    this.visualCoordinator.clearMotionState(reason);
    this.player?.endDistanceDriven?.();
  }

  private async beginDirectionalWalk(direction: "left" | "right", durationMs: number, _reason: "test" | "autonomous" | "onEdge") {
    if (this.isDraggingWindow) return;

    this.walkRequestId++;
    const currentWalkId = this.walkRequestId;

    const floorInfo = await this.floorController.getCurrentFloorInfo();
    if (!floorInfo) return;

    const config = this.getMotionConfig();
    const speed = config.walkSpeed;
    const source = this.loader.getCharacterSource();
    const res = resolveDirectionalAnimation(source, direction, (name) => this.player.hasAnimation(name));

    this.facingController.setFacing(res.facing, res.useFacingMirror ? config.supportsHorizontalFlip : false);
    this.player.setFacing?.(res.facing);
    this.visualCoordinator.setMotionState(direction === 'left' ? 'walk-left' : 'walk-right');

    this.player.beginDistanceDriven({
      animation: res.animation,
      frameCount: 8,
      strideLengthPx: DEFAULT_CODEX_LOCOMOTION.walkStrideLengthPx
    });

    this.stateMachine.forceState('walk');

    this.motionController.startWalk(
      speed,
      direction,
      durationMs,
      floorInfo,
      this.settings,
      () => {
        if (currentWalkId !== this.walkRequestId) return;
        if (this.settings.edgeBehavior === 'turn') {
          const newDir = direction === 'left' ? 'right' : 'left';
          this.beginDirectionalWalk(newDir, durationMs, "onEdge");
        } else {
          this.cancelActiveLocomotion("hit edge stop");
          this.trySetState('idle');
        }
      },
      () => {
        if (currentWalkId !== this.walkRequestId) return;
        this.cancelActiveLocomotion("walk complete");
        this.trySetState('idle');
      },
      (progress: MotionProgress) => {
        if (currentWalkId !== this.walkRequestId) return;
        this.player.updateDistanceDriven(progress.totalLogicalDistance);
      }
    );
  }

  private handleManualDragStart(initialDirection: "left" | "right" | null) {
    this.isDraggingWindow = true;
    this.petRoot.classList.remove('is-pressed');
    this.cancelActiveLocomotion("manual drag start");
    this.behaviorPlanner.recordUserInteraction();
    this.stateMachine.forceState('dragged');
    this.visualCoordinator.setMotionState('drag-static');
    this.dragPoseController.reset();

    const scaleFactor = window.devicePixelRatio || 1;
    this.dragDirectionTracker.startDrag(initialDirection, scaleFactor);
  }

  private updateManualDragDirection(direction: HorizontalDirection) {
    if (!this.isDraggingWindow) return;
    const config = this.getMotionConfig();
    const source = this.loader.getCharacterSource();
    const res = resolveDirectionalAnimation(source, direction, (name) => this.player.hasAnimation(name));

    if (this.player.getCurrentAnimation() !== res.animation) {
      this.facingController.setFacing(res.facing, res.useFacingMirror ? config.supportsHorizontalFlip : false);
      this.player.setFacing?.(res.facing);
      this.player.beginDistanceDriven({
        animation: res.animation,
        frameCount: 8,
        strideLengthPx: DEFAULT_CODEX_LOCOMOTION.walkStrideLengthPx
      });
    }

    if (this.dragAnimTimer !== null) {
      clearTimeout(this.dragAnimTimer);
      this.dragAnimTimer = null;
    }
  }

  private handleManualDragProgress(progress: DragProgress) {
    if (this.stateMachine.getState() !== 'dragged' || !this.isDraggingWindow) return;

    const pose = this.dragPoseController.resolveDragPose(
      progress.deltaLogicalX,
      progress.direction
    );

    let anim = "waiting";
    if (pose === "carried-left") {
      anim = "running-left";
      this.visualCoordinator.setMotionState("drag-left");
    } else if (pose === "carried-right") {
      anim = "running-right";
      this.visualCoordinator.setMotionState("drag-right");
    } else if (pose === "carried-vertical") {
      anim = "jumping";
      this.visualCoordinator.setMotionState("drag-vertical");
    } else {
      this.visualCoordinator.setMotionState("drag-static");
    }

    if (anim === "running-left" || anim === "running-right") {
      if (this.player.getCurrentAnimation() !== anim) {
        this.player.beginDistanceDriven({
          animation: anim,
          frameCount: 8,
          strideLengthPx: DEFAULT_CODEX_LOCOMOTION.runStrideLengthPx
        });
      }
      this.player.updateDistanceDriven(progress.totalLogicalDistance);
    } else {
      this.player.endDistanceDriven();
      this.actionDirector.requestAction({
        id: `drag-${pose}`,
        animation: anim,
        priority: 'locomotion',
        source: 'user',
        interruptPolicy: 'extend-same'
      });
    }
  }

  private async handleDragRelease() {
    this.isDraggingWindow = false;
    this.dragDirectionTracker.stopDrag();
    this.petRoot.classList.remove('is-pressed');
    this.player.endDistanceDriven();

    const floorInfo = await this.floorController.getCurrentFloorInfo();
    if (!floorInfo) {
      this.trySetState('idle');
      return;
    }
    
    const appWindow = getCurrentWindow();
    const pos = await appWindow.outerPosition();
    
    if (pos.y < floorInfo.floorWindowY - 3 && this.settings.gravityEnabled) {
      if (this.trySetState('falling')) {
        this.motionController.startFall(floorInfo, this.settings, () => {
          this.trySetState('landing');
        });
      } else {
        this.trySetState('idle');
      }
    } else {
      if (pos.y !== floorInfo.floorWindowY) {
        await appWindow.setPosition(new PhysicalPosition(pos.x, floorInfo.floorWindowY));
      }
      if (!this.trySetState('landing')) {
        this.trySetState('idle');
      }
    }
  }

  public showBubble(text: string) {
    const bubbleText = this.bubble.querySelector('.speech-bubble__text');
    if (bubbleText) {
      bubbleText.textContent = text;
    } else {
      this.bubble.textContent = text;
    }
    
    this.bubble.classList.add('is-visible');
    
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    const durationMs = getDialogueDurationMs(text);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubble.classList.remove('is-visible');
    }, durationMs);
  }

  private startIdleTimers() {
    this.clearTimers();
    if (this.stateMachine.getState() !== 'idle') return;
    
    const context: BehaviorContext = {
      idleDurationMs: 0,
      sinceLastUserInteractionMs: performance.now(),
      lastActionId: this.actionDirector?.getCurrentRequest()?.animation || 'idle',
      recentActions: [],
      facing: this.facingController.getFacing(),
      nearLeftEdge: false,
      nearRightEdge: false,
      currentHour: new Date().getHours()
    };
    const availableActions = ['idle', 'walk', 'sit', 'wave', 'review', 'hop'];
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

  private getRandomDialogueFromGroup(group: string): string | null {
    if (!this.dialogues || !this.dialogues[group] || !Array.isArray(this.dialogues[group])) {
      return null;
    }
    const list = this.dialogues[group];
    if (list.length === 0) return null;
    const item = list[Math.floor(Math.random() * list.length)];
    return typeof item === 'string' ? item : item.text;
  }

  private async checkInitialPosition() {
    const floorInfo = await this.floorController.getCurrentFloorInfo();
    if (!floorInfo) return;
    const appWindow = getCurrentWindow();
    const pos = await appWindow.outerPosition();
    if (pos.y > floorInfo.floorWindowY) {
      await appWindow.setPosition(new PhysicalPosition(pos.x, floorInfo.floorWindowY));
    }
  }

  private async movePetToDefaultPosition() {
    const monitor = await primaryMonitor();
    if (monitor) {
      const appWindow = getCurrentWindow();
      const centerX = Math.round(monitor.position.x + (monitor.size.width / 2) - 100);
      const centerY = Math.round(monitor.position.y + (monitor.size.height / 2) - 100);
      await appWindow.setPosition(new PhysicalPosition(centerX, centerY));
    }
  }

  private async resizePetWindowForCharacter(manifest: CharacterManifest, scale: number): Promise<void> {
    this.floorController.invalidateCache();
    const HORIZONTAL_PADDING = 16;
    const TOP_BUBBLE_RESERVE = 64;
    const BOTTOM_PADDING = 8;

    const frameW = manifest.render?.width || 192;
    const frameH = manifest.render?.height || 208;

    const stageW = Math.round(frameW * scale);
    const stageH = Math.round(frameH * scale);

    this.petStage.style.width = `${stageW}px`;
    this.petStage.style.height = `${stageH}px`;

    const winW = stageW + HORIZONTAL_PADDING * 2;
    const winH = stageH + TOP_BUBBLE_RESERVE + BOTTOM_PADDING;

    const appWindow = getCurrentWindow();
    await appWindow.setSize(new LogicalSize(winW, winH));
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
