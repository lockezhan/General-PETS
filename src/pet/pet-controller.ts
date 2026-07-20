import { CharacterLoader } from './character-loader';
import { DragDirectionTracker } from './drag-direction-tracker';
import { resolveDirectionalAnimation } from './render/directional-animation-resolver';
import { AnimationRenderer } from './render/animation-renderer';
import { FrameSequenceRenderer } from './render/frame-sequence-renderer';
import { CodexAtlasRenderer } from './render/codex-atlas-renderer';
import { InteractionController, InteractionControllerCallbacks } from './interaction-controller';
import { PetState, CharacterManifest, DEFAULT_MOTION_CONFIG, MotionConfig } from '../shared/character-types';
import { PetSettings } from '../shared/pet-settings';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { EVENT_SETTINGS_CHANGED, EVENT_OPEN_SETTINGS, EVENT_RESET_POSITION, EVENT_TEST_WALK, EVENT_TEST_FALL } from '../shared/event-names';
import { primaryMonitor, getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { load } from '@tauri-apps/plugin-store';
import { convertFileSrc } from '@tauri-apps/api/core';

import { PetStateMachine } from './pet-state-machine';
import { FacingController } from './facing-controller';
import { FloorController } from './floor-controller';
import { MotionController } from './motion-controller';
import { BehaviorScheduler, BehaviorType } from './behavior-scheduler';
import { InteractionManifest } from './interaction/interaction-types';
import { validateInteractions } from './character-validator';

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

const MIN_IDLE_DELAY_MS = 30_000;
const MAX_IDLE_DELAY_MS = 90_000;

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
  private behaviorScheduler: BehaviorScheduler;
  
  private bubbleTimer: number | null = null;
  private randomTimer: number | null = null;
  private sleepTimer: number | null = null;
  private sitTimer: number | null = null;
  
  private dragDirectionTracker!: DragDirectionTracker;
  private settings: PetSettings = { ...DEFAULT_SETTINGS };
  private dialogues: any = null;
  private interactionManifest: InteractionManifest | null = null;

  private isDraggingWindow = false;
  private dragAnimTimer: number | null = null;
  private walkRequestId = 0;
  private currentPlayingAnimation: string | null = null;

  private lastShownDialogue = "";

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

    this.player = new FrameSequenceRenderer(this.loader, this.petImage);
    
    this.stateMachine = new PetStateMachine();
    this.facingController = new FacingController(this.petFacingLayer);
    this.floorController = new FloorController();
    this.motionController = new MotionController();
    this.behaviorScheduler = new BehaviorScheduler(this.handleAutonomousBehavior.bind(this));

    this.dragDirectionTracker = new DragDirectionTracker(
      (dir) => {
        // 方向改变时立即切换动画
        this.updateManualDragDirection(dir);
      },
      (dir) => {
        // 持续同方向移动：如果当前未处于对应的方向动画，强制切换
        this.updateManualDragDirection(dir);
        this.armDraggedIdleFallback();
      }
    );

    const interactionCallbacks: InteractionControllerCallbacks = {
      playAnimation: (animName: string, fallback?: string) => {
        this.playCustomAnimation(animName, fallback ?? "idle");
      },
      showDialogue: (text: string) => {
        this.showBubble(text);
      },
      resetBehaviorTimer: () => {
        this.scheduleNextBehavior();
      },
      cancelMotion: () => {
        this.motionController.cancelActiveMotion("interaction cancelMotion");
        if (this.stateMachine.getState() === 'walk' || this.stateMachine.getState() === 'sit') {
          this.stateMachine.forceState('idle');
        }
      },
      setFacing: (facing: "left" | "right") => {
        const config = this.getMotionConfig();
        const source = this.loader.getCharacterSource();
        // Directional walking rows bypass layer reflection in Codex
        const isCodex = source && source.kind === 'installed';
        this.facingController.setFacing(facing, isCodex ? false : config.supportsHorizontalFlip);
        this.player.setFacing?.(facing);
      },
      getRandomDialogueFromGroup: (group: string): string | null => {
        return this.getRandomDialogueFromGroup(group);
      },
      getCurrentState: () => {
        return this.stateMachine.getState();
      },
      getFacing: () => {
        return this.facingController.getFacing();
      },
      onDragStart: (initialDirection) => {
        this.clearTimers();
        this.behaviorScheduler.cancel("drag started");
        this.motionController.cancelActiveMotion("drag started");
        this.trySetState('dragged');
        
        this.isDraggingWindow = true;
        this.dragDirectionTracker.startDrag(initialDirection);
      },
      onDragEnd: () => {
        this.isDraggingWindow = false;
        if (this.dragAnimTimer) {
          clearTimeout(this.dragAnimTimer);
          this.dragAnimTimer = null;
        }
        this.dragDirectionTracker.stopDrag();
        this.motionController.cancelActiveMotion("drag ended");
        this.floorController.invalidateCache();
        this.handleDragRelease();
      },
      onPressVisualStart: () => {
        this.player.play('dragged');
        this.currentPlayingAnimation = 'dragged';
      },
      onPressVisualCancel: () => {
        const currentState = this.stateMachine.getState();
        this.playStateAnimation(currentState);
      }
    };

    this.interaction = new InteractionController(
      this.petRoot,
      this.petImage,
      this.debugOverlayDiv,
      this.settings,
      interactionCallbacks
    );

    // Drag direction movement tracking is handled securely inside DragDirectionTracker using Tauri window event hook

    listen<boolean>("window-visibility-changed", (event) => {
        const visible = event.payload;
        if (!visible) {
            console.log("[pet] window hidden, pausing motion/scheduler");
            this.motionController.cancelActiveMotion("window hidden");
            this.behaviorScheduler.cancel("window hidden");
            if (this.player && (this.player as any).clock) {
              ((this.player as any).clock as any).pause();
            }
        } else {
            console.log("[pet] window shown, rescheduling");
            this.floorController.invalidateCache();
            if (this.player && (this.player as any).clock) {
              ((this.player as any).clock as any).resume();
            }
            this.behaviorScheduler.cancel("window shown reset");
            this.scheduleNextBehavior();
        }
    });

    listen(EVENT_RESET_POSITION, () => {
      console.log("[pet-controller] received EVENT_RESET_POSITION");
      this.floorController.invalidateCache();
      this.movePetToDefaultPosition();
    });

    listen(EVENT_OPEN_SETTINGS, () => {
      console.log("[pet-controller] received EVENT_OPEN_SETTINGS");
      this.openSettingsWindow();
    });

    listen<PetSettings>(EVENT_SETTINGS_CHANGED, async (e) => {
      console.log("[pet-controller] received EVENT_SETTINGS_CHANGED:", e.payload);
      this.floorController.invalidateCache();
      await this.applySettings(e.payload);
    });
    
    listen<{ direction?: unknown }>(EVENT_TEST_WALK, (event) => {
        console.log("[pet-controller] received EVENT_TEST_WALK:", event.payload);
        const direction = event.payload?.direction;
        if (direction !== "left" && direction !== "right") {
          console.warn("[test-walk] invalid direction, ignoring:", direction);
          return;
        }
        void this.startTestWalk(direction);
    });
    
    listen(EVENT_TEST_FALL, async () => {
        console.log("[pet-controller] received EVENT_TEST_FALL");
        await this.handleDragRelease();
    });
  }

  async init() {
    try {
      const store = await load('settings.json');
      const saved = await store.get('pet-settings');
      if (saved) {
        const savedSettings = saved as any;
        if (savedSettings.schemaVersion === 1) {
          this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            schemaVersion: 4,
            autoMovementEnabled: true,
            walkSpeedMultiplier: 1,
            gravityEnabled: true,
            edgeBehavior: "turn",
            interactionEnabled: true,
            hitAreaDebugEnabled: false,
            animationSpeedMultiplier: 1.0
          };
          await store.set('pet-settings', this.settings);
          await store.save();
        } else if (savedSettings.schemaVersion === 2) {
          this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            schemaVersion: 4,
            interactionEnabled: savedSettings.interactionEnabled ?? true,
            hitAreaDebugEnabled: savedSettings.hitAreaDebugEnabled ?? false,
            animationSpeedMultiplier: 1.0
          };
          await store.set('pet-settings', this.settings);
          await store.save();
        } else if (savedSettings.schemaVersion === 3) {
          this.settings = {
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            schemaVersion: 4,
            animationSpeedMultiplier: savedSettings.animationSpeedMultiplier ?? 1.0
          };
          await store.set('pet-settings', this.settings);
          await store.save();
        } else {
          this.settings = { ...DEFAULT_SETTINGS, ...savedSettings };
        }
      }
    } catch (e) {
      console.error("[pet-controller] failed to load store", e);
    }
    
    // Fix startup recovery: Recreate loader using recovered settings.characterId
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
      console.log("[pet] window shown after init completion");
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
  }

  async applySettings(newSettings: PetSettings) {
    console.log("[pet-controller] applySettings called with characterId:", newSettings.characterId);
    this.floorController.invalidateCache();
    const characterChanged = this.settings.characterId !== newSettings.characterId;
    console.log("[pet-controller] applySettings characterChanged:", characterChanged, "currentId:", this.settings.characterId, "newId:", newSettings.characterId);
    
    if (characterChanged) {
      this.motionController.cancelActiveMotion("character changed");
      this.loader = new CharacterLoader(newSettings.characterId);
      try {
        console.log("[pet-controller] load new character start:", newSettings.characterId);
        await this.loader.load();
        console.log("[pet-controller] load new character complete");
        this.recreateRenderer();
        console.log("[pet-controller] recreated renderer");
        await this.player.load();
        console.log("[pet-controller] player load complete");
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
    this.scheduleNextBehavior();
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
        console.warn(`[interactions] Failed to load custom interactions, using virtual whole-sprite mode:`, e);
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
        console.warn(`[interactions] Failed to load built-in interactions.json, using legacy:`, e);
      }
    }
    
    // Fallback to virtual whole-sprite body area if missing
    if (!this.interactionManifest) {
      this.interactionManifest = {
        schemaVersion: 1,
        hitAreas: [
          {
            id: "body",
            name: "身体",
            shape: "rect",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            priority: 1,
            draggable: true
          }
        ],
        rules: [
          {
            id: "click-waving",
            event: "singleClick",
            area: "body",
            states: ["idle", "sit", "walk"],
            priority: 10,
            actions: [
              { type: "playAnimation", animation: "happy", fallback: "idle" },
              { type: "showDialogue", group: "singleClick" }
            ]
          },
          {
            id: "doubleclick-waving",
            event: "doubleClick",
            area: "body",
            states: ["idle", "sit", "walk"],
            priority: 10,
            actions: [
              { type: "playAnimation", animation: "happy", fallback: "idle" },
              { type: "showDialogue", group: "doubleClick" }
            ]
          },
          {
            id: "rapidclick-failed",
            event: "rapidClick",
            area: "body",
            states: ["idle", "sit", "walk"],
            priority: 10,
            actions: [
              { type: "playAnimation", animation: "angry", fallback: "idle" },
              { type: "showDialogue", group: "rapidClick" }
            ]
          },
          {
            id: "longpress-waving",
            event: "longPress",
            area: "body",
            states: ["idle", "sit"],
            priority: 10,
            actions: [
              { type: "playAnimation", animation: "happy", fallback: "idle" },
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

  async resizePetWindowForCharacter(manifest: CharacterManifest, scale: number): Promise<void> {
    this.floorController.invalidateCache();
    const HORIZONTAL_PADDING = 16;
    const TOP_BUBBLE_RESERVE = 64;
    const BOTTOM_PADDING = 8;
    
    const width = Math.ceil(manifest.render.width * scale + HORIZONTAL_PADDING * 2);
    const height = Math.ceil(manifest.render.height * scale + TOP_BUBBLE_RESERVE + BOTTOM_PADDING);
    
    const scaledWidth = manifest.render.width * scale;
    const scaledHeight = manifest.render.height * scale;
    
    if (this.player.resize) {
      this.player.resize(scaledWidth, scaledHeight);
    } else {
      this.petImage.style.width = `${scaledWidth}px`;
      this.petImage.style.height = `${scaledHeight}px`;
      this.petImage.style.transform = "none";
      this.petImage.style.objectFit = "contain";
      this.petImage.style.objectPosition = "center bottom";
      this.petImage.style.transformOrigin = "center bottom";
    }

    const appWindow = getCurrentWindow();
    const oldPosition = await appWindow.outerPosition();
    const oldSize = await appWindow.outerSize();
    
    await appWindow.setSize(new LogicalSize(width, height));
    
    const scaleFactor = await appWindow.scaleFactor();
    const newPhysicalWidth = Math.round(width * scaleFactor);
    const newPhysicalHeight = Math.round(height * scaleFactor);
    
    const nextX = oldPosition.x + Math.round((oldSize.width - newPhysicalWidth) / 2);
    const nextY = oldPosition.y + oldSize.height - newPhysicalHeight;
    
    await appWindow.setPosition(new PhysicalPosition(nextX, nextY));
    
    await this.clampPetWindowToVisibleArea();
  }

  async checkInitialPosition() {
    const isFirstRunDone = localStorage.getItem('first_run_done');
    if (!isFirstRunDone) {
      await this.movePetToDefaultPosition();
      localStorage.setItem('first_run_done', 'true');
    } else {
      await this.clampPetWindowToVisibleArea();
    }
  }

  async clampPetWindowToVisibleArea(): Promise<void> {
    try {
      const appWindow = getCurrentWindow();
      const currentPos = await appWindow.outerPosition();
      const size = await appWindow.outerSize();
      
      const monitor = await currentMonitor() || await primaryMonitor();
      if (!monitor) return;
      
      const workArea = monitor.workArea;
      
      const minX = workArea.position.x - size.width + 40;
      const maxX = workArea.position.x + workArea.size.width - 40;
      const minY = workArea.position.y - size.height + 40;
      const maxY = workArea.position.y + workArea.size.height - 40;
      
      let newX = Math.max(minX, Math.min(currentPos.x, maxX));
      let newY = Math.max(minY, Math.min(currentPos.y, maxY));
      
      if (newX !== currentPos.x || newY !== currentPos.y) {
        await appWindow.setPosition(new PhysicalPosition(newX, newY));
      }
    } catch(e) {
      console.error("Failed to clamp position:", e);
    }
  }

  async movePetToDefaultPosition(): Promise<void> {
    try {
      const monitor = await primaryMonitor();
      if (!monitor) return;
      const appWindow = getCurrentWindow();
      const size = await appWindow.outerSize();
      
      const workArea = monitor.workArea;
      const scaleFactor = monitor.scaleFactor;
      
      let newX = workArea.position.x + workArea.size.width - size.width - 20 * scaleFactor;
      let newY = workArea.position.y + workArea.size.height - size.height - 20 * scaleFactor;
      
      if (newX < 0) newX = 0;
      if (newY < 0) newY = 0;

      await appWindow.setPosition(new PhysicalPosition(newX, newY));
    } catch(e) {
      console.error("Failed to set position:", e);
    }
  }

  private trySetState(newState: PetState): boolean {
    if (this.stateMachine.setState(newState)) {
        this.playStateAnimation(newState);
        return true;
    }
    return false;
  }

  private playCustomAnimation(animName: string, fallback: string = "idle") {
    const currentState = this.stateMachine.getState();
    const protectedStates = ['dragged', 'falling', 'landing'];
    if (protectedStates.includes(currentState)) {
      console.warn(`[pet] Cannot play custom animation ${animName} while in ${currentState}`);
      return;
    }
    
    if (!this.player.hasAnimation(animName)) {
      console.warn(`[pet] Custom animation "${animName}" not found for current character, skipping`);
      return;
    }

    this.stateMachine.forceState(animName);

    this.player.play(animName, {
      speedMultiplier: this.settings.animationSpeedMultiplier,
      onComplete: (_nextState) => {
        if (this.stateMachine.getState() === animName) {
          const resolvedFallback = this.player.hasAnimation(fallback) ? fallback : 'idle';
          this.trySetState(resolvedFallback as PetState);
        }
      }
    });
    this.currentPlayingAnimation = animName;
  }
  
  private playStateAnimation(state: PetState) {
    this.player.play(state, {
      speedMultiplier: this.settings.animationSpeedMultiplier,
      onComplete: (nextState) => {
        if (this.stateMachine.getState() === state) {
            this.trySetState(nextState as PetState);
        }
      }
    });
    this.currentPlayingAnimation = state;
    
    if (state === 'idle') {
        this.scheduleNextBehavior();
    }
  }

  private getMotionConfig(): MotionConfig {
      const manifest = this.loader.getConfig();
      if (manifest && manifest.motion) {
          return { ...DEFAULT_MOTION_CONFIG, ...manifest.motion };
      }
      return DEFAULT_MOTION_CONFIG;
  }

  private scheduleNextBehavior() {
      if (this.stateMachine.getState() !== 'idle' && this.stateMachine.getState() !== 'sit') {
          return;
      }
      this.behaviorScheduler.scheduleNext(this.getMotionConfig(), this.settings);
  }

  private async handleAutonomousBehavior(type: BehaviorType) {
      if (this.stateMachine.getState() !== 'idle' && this.stateMachine.getState() !== 'sit') {
          return;
      }

      if (type === "idle") {
          this.trySetState("idle");
      } else if (type === "expression") {
          const randomAction: PetState = Math.random() > 0.5 ? "happy" : "angry";
          this.handleLegacyAction(randomAction, "idle");
      } else if (type === "sit") {
          if (!this.trySetState("sit")) return;
          const sitDuration = Math.random() * 7000 + 3000;
          if (this.sitTimer) clearTimeout(this.sitTimer);
          this.sitTimer = window.setTimeout(() => {
              this.sitTimer = null;
              if (this.stateMachine.getState() === 'sit') {
                  this.trySetState('idle');
              }
          }, sitDuration);
      } else if (type === "walk") {
          const dir = Math.random() > 0.5 ? "left" : "right";
          this.startWalk({ reason: 'autonomous', direction: dir });
      }
  }

  public async startWalk(command: { reason: 'test' | 'autonomous' | 'onEdge'; direction: 'left' | 'right' }) {
      const requestId = ++this.walkRequestId;
      const floorInfo = await this.floorController.getCurrentFloorInfo();
      if (!floorInfo) return;
      await this.beginDirectionalWalk({
        requestId,
        reason: command.reason,
        direction: command.direction,
        floorInfo
      });
  }

  private async startTestWalk(direction: 'left' | 'right') {
      const requestId = ++this.walkRequestId;
      const currentState = this.stateMachine.getState();

      if (
        currentState === "dragged" ||
        currentState === "falling" ||
        currentState === "landing"
      ) {
        console.warn("[test-walk] blocked by protected state", currentState);
        return;
      }

      this.clearTimers();
      if (this.sitTimer) {
        clearTimeout(this.sitTimer);
        this.sitTimer = null;
      }
      this.behaviorScheduler.cancel("settings test walk");
      this.motionController.cancelActiveMotion("settings test walk");

      // 强占当前反应动画
      this.player.stop();
      this.stateMachine.forceState("walk");

      const floorInfo = await this.floorController.getCurrentFloorInfo();
      if (!floorInfo) return;

      if (requestId !== this.walkRequestId) {
        return;
      }

      await this.beginDirectionalWalk({
        requestId,
        reason: "test",
        direction,
        floorInfo
      });
  }

  private async beginDirectionalWalk(command: {
    requestId: number;
    reason: "test" | "autonomous" | "onEdge";
    direction: "left" | "right";
    floorInfo: any;
  }) {
      const config = this.getMotionConfig();
      const dir = command.direction;
      const source = this.loader.getCharacterSource();
      const stateBefore = this.stateMachine.getState();
      
      const stateAccepted = this.stateMachine.setState("walk");
      if (!stateAccepted) return;

      const res = resolveDirectionalAnimation(source, dir, (name) => this.player.hasAnimation(name));
      this.facingController.setFacing(res.facing, res.useFacingMirror ? config.supportsHorizontalFlip : false);
      this.player.setFacing?.(res.facing);
      
      this.player.play(res.animation, {
        loop: true,
        speedMultiplier: this.settings.animationSpeedMultiplier,
        onComplete: (nextState) => {
          if (this.stateMachine.getState() === 'walk' && command.requestId === this.walkRequestId) {
            this.trySetState(nextState as PetState);
          }
        }
      });
      this.currentPlayingAnimation = res.animation;

      const duration = command.reason === 'test' 
          ? 3000
          : Math.random() * (config.walkDurationMaxMs - config.walkDurationMinMs) + config.walkDurationMinMs;

      // 提取快照诊断数据
      const characterId = this.settings.characterId;
      const sourceKind = source ? source.kind : "builtin";
      const isCodex = sourceKind === "installed";
      
      let adapterKey: string | null = null;
      let mappedCodexAnimation: string | null = null;
      let atlasRow: number | null = null;
      
      if (isCodex && (this.player as any).adapter) {
        const adapter = (this.player as any).adapter;
        adapterKey = res.animation;
        mappedCodexAnimation = adapter.animationMapping[res.animation] || null;
        if (mappedCodexAnimation) {
          const contractModule = await import('./codex/codex-atlas-contract');
          const baseAnims = contractModule.CODEX_BASE_ANIMATIONS;
          if (mappedCodexAnimation in baseAnims) {
            atlasRow = (baseAnims[mappedCodexAnimation as keyof typeof baseAnims] as any).row;
          }
        }
      }
      
      const logicalFacing = this.facingController.getFacing();
      const cssFacing = this.petFacingLayer.dataset.facing as "left" | "right" || "right";
      
      let viewportTransform = "none";
      const viewport = this.petFacingLayer.querySelector('.codex-frame-viewport') as HTMLElement;
      if (viewport) {
        viewportTransform = viewport.style.transform || "none";
      }

      const velocityX = dir === "left" ? -config.walkSpeed : config.walkSpeed;

      const snapshot: WalkDebugSnapshot = {
        requestId: command.requestId,
        reason: command.reason,
        requestedDirection: dir,
        stateBefore,
        stateAccepted,
        characterId,
        sourceKind,
        logicalAnimation: res.animation,
        adapterKey,
        mappedCodexAnimation,
        atlasRow,
        logicalFacing,
        cssFacing,
        viewportTransform,
        velocityX
      };

      console.log("[walk-trace]\n" + 
        `reason=${snapshot.reason}\n` +
        `requestedDirection=${snapshot.requestedDirection}\n` +
        `stateBefore=${snapshot.stateBefore}\n` +
        `stateAccepted=${snapshot.stateAccepted}\n` +
        `logicalAnimation=${snapshot.logicalAnimation}\n` +
        `adapterKey=${snapshot.adapterKey}\n` +
        `mappedCodexAnimation=${snapshot.mappedCodexAnimation}\n` +
        `atlasRow=${snapshot.atlasRow}\n` +
        `logicalFacing=${snapshot.logicalFacing}\n` +
        `cssFacing=${snapshot.cssFacing}\n` +
        `viewportTransform=${snapshot.viewportTransform}\n` +
        `velocityX=${snapshot.velocityX}`
      );

      this.motionController.startWalk(
          config.walkSpeed,
          dir,
          duration,
          command.floorInfo,
          this.settings,
          () => {
              if (command.requestId !== this.walkRequestId) return;
              if (this.settings.edgeBehavior === "stop" || command.reason === 'test') {
                  if (this.stateMachine.getState() === 'walk') this.trySetState('idle');
              } else {
                  const nextFace = dir === "left" ? "right" : "left";
                  this.startWalk({ reason: 'onEdge', direction: nextFace });
              }
          },
          () => {
              if (command.requestId !== this.walkRequestId) return;
              if (this.stateMachine.getState() === 'walk') this.trySetState('idle');
          }
      );
  }

  /**
   * 手动拖动时更新方向动画。
   * 不调用 MotionController — Windows startDragging() 已经控制窗口位置。
   * 注意：此处不调用 armDraggedIdleFallback()，
   * 改为仅在 onMovementActivity（onMoved 窗口事件触发）时才重置计时器。
   * 这样即使 Tauri 原生拖动期间 onMoved 未及时触发，方向动画也会持续播放。
   */
  private updateManualDragDirection(direction: 'left' | 'right') {
    if (this.stateMachine.getState() !== 'dragged' || !this.isDraggingWindow) return;

    const config = this.getMotionConfig();
    const source = this.loader.getCharacterSource();
    const res = resolveDirectionalAnimation(source, direction, (name) => this.player.hasAnimation(name));

    // 如果当前正在播放的已经是我们所期望的方向动画，且朝向相同，就不要重复 play()
    if (this.currentPlayingAnimation === res.animation && this.facingController.getFacing() === res.facing) {
      return;
    }

    this.facingController.setFacing(res.facing, res.useFacingMirror ? config.supportsHorizontalFlip : false);
    this.player.setFacing?.(res.facing);
    this.player.play(res.animation, {
      loop: true,
      speedMultiplier: this.settings.animationSpeedMultiplier
    });
    this.currentPlayingAnimation = res.animation;

    // 方向切换时清除已有的回退计时器，但不重新 arm
    // 只有 onMovementActivity（即窗口实际移动事件）才重新 arm 计时器
    if (this.dragAnimTimer !== null) {
      clearTimeout(this.dragAnimTimer);
      this.dragAnimTimer = null;
    }
  }

  /**
   * 设置「停止移动后回退到 dragged 动画」的定时器。
   * 仅在 onMovementActivity 回调中调用（即 Tauri onMoved 窗口事件触发时）。
   * 不在方向切换时调用，避免 onMoved 稀疏时动画被提前中断。
   */
  private armDraggedIdleFallback() {
    if (this.stateMachine.getState() !== 'dragged' || !this.isDraggingWindow) return;

    if (this.dragAnimTimer !== null) {
      clearTimeout(this.dragAnimTimer);
    }

    this.dragAnimTimer = window.setTimeout(() => {
      if (this.stateMachine.getState() === 'dragged' && this.isDraggingWindow) {
        this.player.play('dragged', {
          loop: true,
          speedMultiplier: this.settings.animationSpeedMultiplier
        });
        this.currentPlayingAnimation = 'dragged';
      }
      this.dragAnimTimer = null;
    }, 600); // 600ms：给 onMoved 事件更充裕的时间重置计时器
  }

  private async handleDragRelease() {
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

  private handleLegacyAction(state: PetState, dialogueKey: string) {
    if (this.stateMachine.getState() === 'dragged' || this.stateMachine.getState() === 'sleep') return;
    this.clearTimers();
    
    const text = this.getRandomDialogueFromGroup(dialogueKey);
    if (text) this.showBubble(text);
    this.trySetState(state);
  }

  private getRandomDialogueFromGroup(group: string): string | null {
    if (!this.dialogues || !this.dialogues[group]) {
      return null;
    }
    const list: string[] = this.dialogues[group];
    if (!Array.isArray(list) || list.length === 0) return null;
    
    const validLines = list.filter(l => typeof l === 'string' && l.trim().length > 0);
    if (validLines.length === 0) return null;
    
    if (validLines.length > 1) {
      const filtered = validLines.filter(l => l !== this.lastShownDialogue);
      const chosen = filtered[Math.floor(Math.random() * filtered.length)];
      this.lastShownDialogue = chosen;
      return chosen;
    }
    
    this.lastShownDialogue = validLines[0];
    return validLines[0];
  }

  private showBubble(text: string) {
    const textEl = this.bubble.querySelector('.speech-bubble__text');
    if (textEl) {
      textEl.textContent = text;
    } else {
      this.bubble.textContent = text;
    }
    
    this.bubble.classList.add('is-visible');
    
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => {
      this.bubble.classList.remove('is-visible');
    }, 2000);
  }

  private startIdleTimers() {
    this.clearTimers();
    if (this.stateMachine.getState() !== 'idle') return;
    
    if (this.settings.randomDialogueEnabled) {
      const delay = Math.random() * (MAX_IDLE_DELAY_MS - MIN_IDLE_DELAY_MS) + MIN_IDLE_DELAY_MS;
      this.randomTimer = window.setTimeout(() => {
        if (this.stateMachine.getState() === 'idle') {
          this.handleLegacyAction('happy', 'idle');
        }
      }, delay);
    }
    
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
    if (this.randomTimer) clearTimeout(this.randomTimer);
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    if (this.sitTimer) {
      clearTimeout(this.sitTimer);
      this.sitTimer = null;
    }
  }
  
  private async openSettingsWindow() {
    const existing = await WebviewWindow.getByLabel("settings");

    if (existing) {
      await existing.show();
      await existing.unminimize();
      await existing.setFocus();
      return;
    }

    new WebviewWindow("settings", {
      url: "settings/index.html",
      title: "General PETS 设置",
      width: 520,
      height: 640,
      minWidth: 440,
      minHeight: 540,
      resizable: true,
      decorations: true,
      transparent: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      center: true,
    });
  }

  destroy() {
    this.interaction.destroy();
    if (this.dragDirectionTracker) {
      this.dragDirectionTracker.destroy();
    }
    this.clearTimers();
    if (this.player) {
      this.player.destroy();
    }
    this.behaviorScheduler.cancel("destroy");
    this.motionController.cancelActiveMotion("destroy");
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
  }
}
