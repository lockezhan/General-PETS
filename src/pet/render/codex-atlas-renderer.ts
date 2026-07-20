import { AnimationRenderer, AnimationPlaybackOptions } from './animation-renderer';
import { CodexAdapterConfig } from '../codex/codex-types';
import { CODEX_ATLAS_CONTRACTS, CODEX_BASE_ANIMATIONS, CODEX_DEFAULT_TIMINGS, CodexV1AnimationName } from '../codex/codex-atlas-contract';
import { PetState } from '../../shared/character-types';
import { AnimationClock } from './animation-clock';

export class CodexAtlasRenderer implements AnimationRenderer {
  private element: HTMLImageElement;
  private spritesheetUrl: string;
  private adapter: CodexAdapterConfig;
  private viewport: HTMLDivElement | null = null;
  private clock: AnimationClock;

  private currentAnimation = 'idle';
  private currentMappedAnimation: CodexV1AnimationName = 'idle';
  private currentConfig: typeof CODEX_BASE_ANIMATIONS[keyof typeof CODEX_BASE_ANIMATIONS] | null = null;
  private facing: 'left' | 'right' = 'right';

  private onCompleteCallback: ((nextState: PetState) => void) | null = null;
  private currentFrameIndex = 0;
  private loopEnabled = true;

  constructor(element: HTMLImageElement, spritesheetUrl: string, adapterConfig: CodexAdapterConfig) {
    this.element = element;
    this.spritesheetUrl = spritesheetUrl;
    this.adapter = adapterConfig;

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
    const parent = this.element.parentElement;
    if (parent && !parent.classList.contains('codex-frame-viewport')) {
      this.viewport = document.createElement('div');
      this.viewport.className = 'codex-frame-viewport';
      
      this.viewport.style.position = 'relative';
      this.viewport.style.overflow = 'hidden';
      this.viewport.style.background = 'transparent';
      this.viewport.style.border = '0';
      this.viewport.style.outline = '0';
      this.viewport.style.boxShadow = 'none';
      
      const contract = CODEX_ATLAS_CONTRACTS[this.adapter.spriteVersionNumber || 1];
      let width = this.adapter.render?.frameWidth || contract.frameWidth;
      let height = this.adapter.render?.frameHeight || contract.frameHeight;
      
      // Inherit existing styled dimensions if preset
      if (this.element.style.width && this.element.style.width.endsWith('px')) {
        const parsedW = parseFloat(this.element.style.width);
        if (!isNaN(parsedW) && parsedW > 0) width = parsedW;
      }
      if (this.element.style.height && this.element.style.height.endsWith('px')) {
        const parsedH = parseFloat(this.element.style.height);
        if (!isNaN(parsedH) && parsedH > 0) height = parsedH;
      }
      
      this.viewport.style.width = `${width}px`;
      this.viewport.style.height = `${height}px`;

      parent.insertBefore(this.viewport, this.element);
      this.viewport.appendChild(this.element);
    } else {
      this.viewport = parent as HTMLDivElement;
    }

    this.element.src = this.spritesheetUrl;
    this.element.className = 'pet-sprite codex-atlas-image';
    this.element.style.position = 'absolute';
    this.element.style.left = '0';
    this.element.style.top = '0';
    this.element.style.maxWidth = 'none';
    this.element.style.maxHeight = 'none';
    this.element.style.userSelect = 'none';
    this.element.style.pointerEvents = 'none';
  }

  async load(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.element.complete) {
        resolve();
        return;
      }
      this.element.onload = () => resolve();
      this.element.onerror = (e) => reject(new Error(`Failed to load spritesheet: ${e}`));
    });
  }

  hasAnimation(name: string): boolean {
    const logical = this.normalizeLogicalAnimationName(name);
    let resolvedName = logical;
    if (logical === 'walk') {
      resolvedName = this.facing === 'left' ? 'walkLeft' : 'walkRight';
    }
    const mapped = this.adapter.animationMapping[resolvedName as keyof typeof this.adapter.animationMapping];
    return !!(mapped && CODEX_BASE_ANIMATIONS[mapped as keyof typeof CODEX_BASE_ANIMATIONS]);
  }

  play(name: string, options?: AnimationPlaybackOptions): void {
    // 归一化：接受 running-left/running-right 兼容旧调用，立即转为逻辑键
    const logical = this.normalizeLogicalAnimationName(name);
    let resolvedName = logical;
    if (logical === 'walk') {
      resolvedName = this.facing === 'left' ? 'walkLeft' : 'walkRight';
    }

    const mapped = this.adapter.animationMapping[resolvedName as keyof typeof this.adapter.animationMapping] as CodexV1AnimationName;
    const config = CODEX_BASE_ANIMATIONS[mapped];
    const defaultTiming = CODEX_DEFAULT_TIMINGS[mapped];

    if (!config || !defaultTiming) {
      console.warn(`[CodexAtlasRenderer] Unmapped state: ${name} -> logical=${logical} -> mapped=${mapped}`);
      if (options?.onComplete) options.onComplete('idle');
      return;
    }

    this.clock.stop();

    // currentAnimation 存逻辑键（walkLeft/walkRight），currentMappedAnimation 存图集名（running-left/running-right）
    this.currentAnimation = resolvedName;
    this.currentMappedAnimation = mapped;
    this.currentConfig = config;
    this.onCompleteCallback = options?.onComplete || null;
    this.loopEnabled = options?.loop !== undefined ? options.loop : defaultTiming.loop;

    // Resolve Timing Config
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

    const speed = options?.speedMultiplier !== undefined ? options.speedMultiplier : 1.0;
    this.clock.play(name, timing, config.frameCount, speed);
  }

  stop(): void {
    this.clock.stop();
  }

  setFacing(facing: "left" | "right"): void {
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
    if (this.viewport) {
      this.viewport.style.width = `${width}px`;
      this.viewport.style.height = `${height}px`;
    }
    this.renderFrame();
  }

  updateSpeedMultiplier(speed: number) {
    this.clock.updateSpeedMultiplier(speed);
  }

  destroy(): void {
    this.clock.destroy();

    if (this.viewport && this.viewport.parentElement) {
      const originalParent = this.viewport.parentElement;
      originalParent.insertBefore(this.element, this.viewport);
      originalParent.removeChild(this.viewport);
    }

    this.element.className = 'pet-sprite';
    this.element.style.position = '';
    this.element.style.left = '';
    this.element.style.top = '';
    this.element.style.width = '';
    this.element.style.height = '';
    this.element.style.transform = '';
    this.element.style.maxWidth = '';
    this.element.style.maxHeight = '';
    this.element.style.userSelect = '';
    this.element.style.pointerEvents = '';
  }

  private renderFrame() {
    if (!this.currentConfig || !this.viewport) return;

    const ver = this.adapter.spriteVersionNumber || 1;
    const contract = CODEX_ATLAS_CONTRACTS[ver];

    const row = this.currentConfig.row;
    const col = this.currentFrameIndex;

    const rect = this.viewport.getBoundingClientRect();
    const dispWidth = rect.width || contract.frameWidth;
    const dispHeight = rect.height || contract.frameHeight;

    const scaleX = dispWidth / contract.frameWidth;
    const scaleY = dispHeight / contract.frameHeight;

    this.element.style.width = `${contract.atlasWidth * scaleX}px`;
    this.element.style.height = `${contract.atlasHeight * scaleY}px`;

    const sourceX = col * contract.frameWidth;
    const sourceY = row * contract.frameHeight;
    this.element.style.transform = `translate(${-sourceX * scaleX}px, ${-sourceY * scaleY}px)`;

    // currentMappedAnimation 是 play() 时已经解析好的图集级名称（running-left/running-right）
    // 用于判断是否为方向行走动画，避免重复映射
    const isDirectionalWalk =
      this.currentMappedAnimation === 'running-left' ||
      this.currentMappedAnimation === 'running-right';

    if (this.facing === 'left' && !isDirectionalWalk) {
      this.viewport.style.transform = 'scaleX(-1)';
    } else {
      this.viewport.style.transform = 'none';
    }
  }

  /**
   * 归一化逻辑动画名称。
   * running-left → walkLeft，running-right → walkRight（向后兼容旧调用方）。
   * currentAnimation 只应存储 walkLeft/walkRight/idle 等逻辑键，不存储 running-* 系列名称。
   */
  private normalizeLogicalAnimationName(name: string): string {
    if (name === 'running-left') return 'walkLeft';
    if (name === 'running-right') return 'walkRight';
    return name;
  }
}
