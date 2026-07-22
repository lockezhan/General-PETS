import {
  AnimationRenderer,
  AnimationPlaybackOptions,
  DistanceDrivenPlayback,
  FramePathPlaybackOptions,
  AtlasFrameReference,
} from './animation-renderer';
import { CodexAdapterConfig, GeneralPetsExtrasConfig } from '../codex/codex-types';
import { CODEX_ATLAS_CONTRACTS, CODEX_BASE_ANIMATIONS, CODEX_DEFAULT_TIMINGS, CodexV1AnimationName } from '../codex/codex-atlas-contract';
import { PetState } from '../../shared/character-types';
import { AnimationClock } from './animation-clock';

export class CodexAtlasRenderer implements AnimationRenderer {
  private element: HTMLImageElement;
  private spritesheetUrl: string;
  private adapter: CodexAdapterConfig;
  
  private viewport: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private atlasImage: HTMLImageElement;
  private extrasImage: HTMLImageElement | null = null;
  private extrasConfig: GeneralPetsExtrasConfig | null = null;
  
  private clock: AnimationClock;
  private speedMultiplier = 1.0;

  private currentAnimation: string | null = null;
  private currentMappedAnimation: CodexV1AnimationName = 'idle';
  private currentConfig: typeof CODEX_BASE_ANIMATIONS[keyof typeof CODEX_BASE_ANIMATIONS] | null = null;
  private facing: 'left' | 'right' = 'right';

  private playbackMode: 'clock' | 'distance' | 'stopped' = 'stopped';
  private distanceConfig: DistanceDrivenPlayback | null = null;

  private onCompleteCallback: ((nextState: PetState) => void) | null = null;
  private currentFrameIndex = 0;
  private currentFramePath: AtlasFrameReference[] | null = null;
  private loopEnabled = true;

  private displayWidth = 192;
  private displayHeight = 208;

  constructor(
    element: HTMLImageElement,
    spritesheetUrl: string,
    adapterConfig: CodexAdapterConfig,
    extrasConfig?: GeneralPetsExtrasConfig | null,
    extrasSpritesheetUrl?: string | null,
  ) {
    this.element = element;
    this.spritesheetUrl = spritesheetUrl;
    this.adapter = adapterConfig;

    this.atlasImage = new Image();
    this.extrasConfig = extrasConfig ?? null;
    if (this.extrasConfig && extrasSpritesheetUrl) {
      this.extrasImage = new Image();
      this.extrasImage.src = extrasSpritesheetUrl;
    }

    this.clock = new AnimationClock({
      onFrameChange: (frameIndex) => {
        this.currentFrameIndex = frameIndex;
        this.renderFrame();
      },
      onComplete: (fallbackState) => {
        if (this.onCompleteCallback) {
          this.onCompleteCallback(fallbackState as PetState);
        }
      }
    });

    this.setupDOM();
  }

  private setupDOM() {
    const ver = this.adapter.spriteVersionNumber || 1;
    const contract = CODEX_ATLAS_CONTRACTS[ver];
    this.displayWidth = this.adapter.render?.frameWidth || contract.frameWidth;
    this.displayHeight = this.adapter.render?.frameHeight || contract.frameHeight;

    if (this.element.style.width && this.element.style.width.endsWith('px')) {
      const parsedW = parseFloat(this.element.style.width);
      if (!isNaN(parsedW) && parsedW > 0) this.displayWidth = parsedW;
    }
    if (this.element.style.height && this.element.style.height.endsWith('px')) {
      const parsedH = parseFloat(this.element.style.height);
      if (!isNaN(parsedH) && parsedH > 0) this.displayHeight = parsedH;
    }

    const parent = this.element.parentElement;
    this.viewport = document.createElement('div');
    this.viewport.className = 'codex-frame-viewport';
    this.viewport.style.position = 'relative';
    this.viewport.style.overflow = 'hidden';
    this.viewport.style.background = 'transparent';
    this.viewport.style.border = '0';
    this.viewport.style.outline = '0';
    this.viewport.style.boxShadow = 'none';
    this.viewport.style.transform = 'none';
    this.viewport.style.width = `${this.displayWidth}px`;
    this.viewport.style.height = `${this.displayHeight}px`;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'codex-frame-canvas';
    this.canvas.style.display = 'block';
    this.canvas.style.width = `${this.displayWidth}px`;
    this.canvas.style.height = `${this.displayHeight}px`;

    this.ctx = this.canvas.getContext('2d');

    if (parent) {
      parent.insertBefore(this.viewport, this.element);
      this.viewport.appendChild(this.canvas);
      this.viewport.appendChild(this.element);
      this.element.style.display = 'block';
      this.element.style.opacity = '0';
      this.element.style.position = 'absolute';
      this.element.style.left = '0';
      this.element.style.top = '0';
      this.element.style.width = `${this.displayWidth}px`;
      this.element.style.height = `${this.displayHeight}px`;
      this.element.style.pointerEvents = 'none';
    }

    this.atlasImage.src = this.spritesheetUrl;
  }

  async load(): Promise<void> {
    await Promise.all([
      this.loadImage(this.atlasImage, 'atlas'),
      ...(this.extrasImage ? [this.loadImage(this.extrasImage, 'extras atlas')] : []),
    ]);
  }

  hasAnimation(name: string): boolean {
    return this.resolveMappedAnimation(name) !== null;
  }

  play(name: string, options?: AnimationPlaybackOptions): void {
    const resolvedName = this.normalizeLogicalAnimationName(name);
    const mapped = this.resolveMappedAnimation(resolvedName);

    if (!mapped) {
      console.warn(`[CodexAtlasRenderer] Unmapped animation: ${name}`);
      this.traceAnimationRequest(name, resolvedName, null, null, false);
      options?.onComplete?.('idle');
      return;
    }

    const config = CODEX_BASE_ANIMATIONS[mapped];
    const defaultTiming = CODEX_DEFAULT_TIMINGS[mapped];

    this.clock.stop();
    this.playbackMode = 'clock';

    this.currentAnimation = resolvedName;
    this.currentFramePath = null;
    this.currentMappedAnimation = mapped;
    this.currentConfig = config;
    this.onCompleteCallback = options?.onComplete || null;
    this.loopEnabled = options?.loop !== undefined ? options.loop : defaultTiming.loop;

    let timing = {
      ...defaultTiming,
      ...(this.adapter.animationSequences?.[mapped]
        ? { frameSequence: [...this.adapter.animationSequences[mapped]!] }
        : {}),
    };
    if (options?.timingOverride) {
      timing = { ...timing, ...options.timingOverride };
    }
    if (options?.loop !== undefined) {
      timing = { ...timing, loop: options.loop };
    }
    if (options?.fallback !== undefined) {
      timing = { ...timing, fallback: options.fallback };
    }

    const speed = options?.speedMultiplier ?? this.speedMultiplier;
    this.traceAnimationRequest(name, resolvedName, mapped, config.row, true);
    this.clock.play(resolvedName, timing, config.frameCount, speed);
  }

  playStaticFrame(row: number, column: number, source: "primary" | "extras" = "primary"): boolean {
    if (!this.isValidAtlasFrame({ row, column, source })) return false;
    this.clock.stop();
    this.playbackMode = 'stopped';
    this.currentAnimation = 'static-frame';
    this.currentConfig = null;
    this.currentFramePath = [{ row, column, source }];
    this.currentFrameIndex = 0;
    this.renderFrame();
    return true;
  }

  playFramePath(options: FramePathPlaybackOptions): boolean {
    if (
      options.frames.length === 0 ||
      options.frames.length > 32 ||
      options.frames.some((frame) => !this.isValidAtlasFrame(frame))
    ) {
      return false;
    }
    this.clock.stop();
    this.playbackMode = 'clock';
    this.currentAnimation = 'lookAround';
    this.currentConfig = null;
    this.currentFramePath = options.frames.map((frame) => ({
      ...frame,
      source: frame.source ?? 'primary',
    }));
    this.onCompleteCallback = options.onComplete ? () => options.onComplete?.() : null;
    const durations = this.currentFramePath.map((frame) => frame.durationMs ?? 500);
    this.clock.play('lookAround', {
      frameDurationMs: 500,
      frameDurationsMs: durations,
      loop: options.loop ?? false,
      fallback: 'idle',
    }, this.currentFramePath.length, options.speedMultiplier ?? this.speedMultiplier);
    return true;
  }

  beginDistanceDriven(config: DistanceDrivenPlayback): void {
    const logical = this.normalizeLogicalAnimationName(config.animation);
    const mapped = this.resolveMappedAnimation(config.animation);

    if (!mapped) {
      console.warn(`[CodexAtlasRenderer] beginDistanceDriven unmapped: ${config.animation}`);
      return;
    }

    const baseConfig = CODEX_BASE_ANIMATIONS[mapped];

    this.clock.stop();
    this.playbackMode = 'distance';
    this.currentAnimation = logical;
    this.currentFramePath = null;
    this.currentMappedAnimation = mapped;
    this.currentConfig = baseConfig;
    this.distanceConfig = config;
    this.currentFrameIndex = 0;
    this.renderFrame();
  }

  updateDistanceDriven(totalLogicalDistance: number): void {
    if (this.playbackMode !== 'distance' || !this.distanceConfig || !this.currentConfig) {
      return;
    }
    const { strideLengthPx, frameCount } = this.distanceConfig;
    if (strideLengthPx <= 0 || frameCount <= 0) return;

    const normalizedPhase = (Math.abs(totalLogicalDistance) % strideLengthPx) / strideLengthPx;
    const frameIndex = Math.min(frameCount - 1, Math.floor(normalizedPhase * frameCount));
    this.currentFrameIndex = frameIndex;
    this.renderFrame();
  }

  endDistanceDriven(fallback?: string): void {
    this.playbackMode = 'stopped';
    this.distanceConfig = null;
    if (fallback && this.hasAnimation(fallback)) {
      this.play(fallback);
    }
  }

  stop(): void {
    this.clock.stop();
    this.playbackMode = 'stopped';
  }

  getCurrentAnimation(): string | null {
    return this.currentAnimation;
  }

  getPlaybackMode(): 'clock' | 'distance' | 'stopped' {
    return this.playbackMode;
  }

  setFacing(facing: 'left' | 'right'): void {
    if (this.facing !== facing) {
      this.facing = facing;
      if (this.currentAnimation === 'walk') {
        this.play('walk', { loop: this.loopEnabled, onComplete: this.onCompleteCallback || undefined });
        return;
      }
    }
    this.renderFrame();
  }

  resize(width: number, height: number): void {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return;
    }

    this.displayWidth = width;
    this.displayHeight = height;
    if (this.viewport) {
      this.viewport.style.width = `${width}px`;
      this.viewport.style.height = `${height}px`;
    }
    if (this.canvas) {
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
    this.renderFrame();
  }

  updateSpeedMultiplier(speed: number): void {
    this.speedMultiplier = Math.max(0.5, Math.min(1.5, speed));
    this.clock.updateSpeedMultiplier(this.speedMultiplier);
  }

  destroy(): void {
    this.clock.destroy();
    this.playbackMode = 'stopped';
    this.currentAnimation = null;

    if (this.viewport && this.viewport.parentElement) {
      const originalParent = this.viewport.parentElement;
      this.element.style.display = '';
      originalParent.insertBefore(this.element, this.viewport);
      originalParent.removeChild(this.viewport);
    }
  }

  public renderFrame(): void {
    if (!this.canvas) return;

    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

    this.canvas.style.width = `${this.displayWidth}px`;
    this.canvas.style.height = `${this.displayHeight}px`;

    const physicalW = Math.round(this.displayWidth * dpr);
    const physicalH = Math.round(this.displayHeight * dpr);

    if (this.canvas.width !== physicalW || this.canvas.height !== physicalH) {
      this.canvas.width = physicalW;
      this.canvas.height = physicalH;
    }

    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.displayWidth, this.displayHeight);
    ctx.imageSmoothingEnabled = false;

    const pathFrame = this.currentFramePath?.[this.currentFrameIndex];
    if (!this.currentConfig && !pathFrame) return;

    const ver = this.adapter.spriteVersionNumber || 1;
    const contract = CODEX_ATLAS_CONTRACTS[ver];

    const row = pathFrame?.row ?? this.currentConfig!.row;
    const col = pathFrame?.column ?? this.currentFrameIndex;
    const useExtras = pathFrame?.source === 'extras';
    const sourceImage = useExtras ? this.extrasImage : this.atlasImage;
    const frameWidth = useExtras ? this.extrasConfig!.frameWidth : contract.frameWidth;
    const frameHeight = useExtras ? this.extrasConfig!.frameHeight : contract.frameHeight;
    if (!sourceImage) return;

    // Integer source coordinates to guarantee no subpixel boundary bleeding
    const sourceX = Math.floor(col * frameWidth);
    const sourceY = Math.floor(row * frameHeight);

    const isDirectionalWalk =
      this.currentMappedAnimation === 'running-left' ||
      this.currentMappedAnimation === 'running-right';

    // Outer viewport transform stays 'none' to avoid double-mirroring
    if (this.viewport) {
      this.viewport.style.transform = 'none';
    }

    if (this.facing === 'left' && !isDirectionalWalk && !pathFrame) {
      ctx.save();
      ctx.translate(this.displayWidth, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(
        sourceImage,
        sourceX,
        sourceY,
        frameWidth,
        frameHeight,
        0,
        0,
        this.displayWidth,
        this.displayHeight
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        sourceImage,
        sourceX,
        sourceY,
        frameWidth,
        frameHeight,
        0,
        0,
        this.displayWidth,
        this.displayHeight
      );
    }
  }

  private normalizeLogicalAnimationName(name: string): string {
    if (name === 'walk') {
      return this.facing === 'left' ? 'walkLeft' : 'walkRight';
    }
    return name;
  }

  private loadImage(image: HTMLImageElement, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (image.complete && image.naturalWidth > 0) {
        resolve();
        return;
      }
      image.onload = () => resolve();
      image.onerror = (error) => reject(new Error(`Failed to load ${label}: ${error}`));
    });
  }

  private isValidAtlasFrame(frame: AtlasFrameReference): boolean {
    if (!Number.isInteger(frame.row) || !Number.isInteger(frame.column) || frame.row < 0 || frame.column < 0) {
      return false;
    }
    if (frame.source === 'extras') {
      if (!this.extrasConfig || !this.extrasImage) return false;
      const animation = this.extrasConfig.animations.lookAround;
      return !!animation && frame.row === animation.row && frame.column < animation.frameCount;
    }
    const contract = CODEX_ATLAS_CONTRACTS[this.adapter.spriteVersionNumber || 1];
    return frame.row < contract.rows && frame.column < contract.columns;
  }

  private resolveMappedAnimation(name: string): CodexV1AnimationName | null {
    const logical = this.normalizeLogicalAnimationName(name);

    if (Object.prototype.hasOwnProperty.call(CODEX_BASE_ANIMATIONS, logical)) {
      return logical as CodexV1AnimationName;
    }

    const mapped = this.adapter.animationMapping[
      logical as keyof typeof this.adapter.animationMapping
    ];

    if (mapped && Object.prototype.hasOwnProperty.call(CODEX_BASE_ANIMATIONS, mapped)) {
      return mapped as CodexV1AnimationName;
    }

    return null;
  }

  private traceAnimationRequest(
    requested: string,
    resolved: string,
    mapped: CodexV1AnimationName | null,
    atlasRow: number | null,
    accepted: boolean
  ): void {
    if (!import.meta.env.DEV) return;
    console.info(
      `[interaction-trace]\n` +
      `requested=${requested}\n` +
      `resolved=${resolved}\n` +
      `mapped=${mapped ?? 'none'}\n` +
      `atlasRow=${atlasRow ?? 'none'}\n` +
      `accepted=${accepted}`
    );
  }
}
