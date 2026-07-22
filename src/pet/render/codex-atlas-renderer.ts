import { AnimationRenderer, AnimationPlaybackOptions, DistanceDrivenPlayback } from './animation-renderer';
import { CodexAdapterConfig } from '../codex/codex-types';
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
  private loopEnabled = true;

  private displayWidth = 192;
  private displayHeight = 208;

  constructor(element: HTMLImageElement, spritesheetUrl: string, adapterConfig: CodexAdapterConfig) {
    this.element = element;
    this.spritesheetUrl = spritesheetUrl;
    this.adapter = adapterConfig;

    this.atlasImage = new Image();

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
    return new Promise((resolve, reject) => {
      if (this.atlasImage.complete && this.atlasImage.naturalWidth > 0) {
        resolve();
        return;
      }
      this.atlasImage.onload = () => resolve();
      this.atlasImage.onerror = (e) => reject(new Error(`Failed to load atlas image: ${e}`));
    });
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
    this.currentMappedAnimation = mapped;
    this.currentConfig = config;
    this.onCompleteCallback = options?.onComplete || null;
    this.loopEnabled = options?.loop !== undefined ? options.loop : defaultTiming.loop;

    let timing = { ...defaultTiming };
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

    if (!this.currentConfig) return;

    const ver = this.adapter.spriteVersionNumber || 1;
    const contract = CODEX_ATLAS_CONTRACTS[ver];

    const row = this.currentConfig.row;
    const col = this.currentFrameIndex;

    // Integer source coordinates to guarantee no subpixel boundary bleeding
    const sourceX = Math.floor(col * contract.frameWidth);
    const sourceY = Math.floor(row * contract.frameHeight);

    const isDirectionalWalk =
      this.currentMappedAnimation === 'running-left' ||
      this.currentMappedAnimation === 'running-right';

    // Outer viewport transform stays 'none' to avoid double-mirroring
    if (this.viewport) {
      this.viewport.style.transform = 'none';
    }

    if (this.facing === 'left' && !isDirectionalWalk) {
      ctx.save();
      ctx.translate(this.displayWidth, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(
        this.atlasImage,
        sourceX,
        sourceY,
        contract.frameWidth,
        contract.frameHeight,
        0,
        0,
        this.displayWidth,
        this.displayHeight
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        this.atlasImage,
        sourceX,
        sourceY,
        contract.frameWidth,
        contract.frameHeight,
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
