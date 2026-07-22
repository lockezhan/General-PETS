import { AnimationRenderer, AnimationPlaybackOptions, DistanceDrivenPlayback } from './animation-renderer';
import { CharacterLoader } from '../character-loader';
import { PetState } from '../../shared/character-types';
import { AnimationClock, resolveAnimationTiming } from './animation-clock';

export class FrameSequenceRenderer implements AnimationRenderer {
  private loader: CharacterLoader;
  private element: HTMLImageElement;
  private clock: AnimationClock;
  private currentFrames: string[] = [];
  private badFrames = new Set<string>();
  private onCompleteCallback: ((nextState: PetState) => void) | null = null;

  private currentAnimation: string | null = null;
  private playbackMode: 'clock' | 'distance' | 'stopped' = 'stopped';
  private distanceConfig: DistanceDrivenPlayback | null = null;

  constructor(loader: CharacterLoader, element: HTMLImageElement) {
    this.loader = loader;
    this.element = element;

    this.clock = new AnimationClock({
      onFrameChange: (frameIndex) => {
        this.renderFrame(frameIndex);
      },
      onComplete: (fallbackState) => {
        if (this.onCompleteCallback) {
          this.onCompleteCallback(fallbackState as PetState);
        }
      }
    });

    this.element.onerror = () => {
      if (this.element.src) {
        try {
          const url = new URL(this.element.src, window.location.href);
          this.badFrames.add(url.pathname);
        } catch (e) {
          // ignore
        }
      }
    };
  }

  async load(): Promise<void> {
    await this.loader.load();
  }

  hasAnimation(name: string): boolean {
    const config = this.loader.getConfig();
    return !!(config && config.animations[name]);
  }

  play(name: string, options?: AnimationPlaybackOptions): void {
    const config = this.loader.getConfig()?.animations[name];
    if (!config) {
      console.warn(`[FrameSequenceRenderer] Animation not found: ${name}`);
      if (options?.onComplete) options.onComplete('idle');
      return;
    }

    this.clock.stop();
    this.playbackMode = 'clock';
    this.currentAnimation = name;
    this.onCompleteCallback = options?.onComplete || null;
    this.currentFrames = this.loader.getFrames(name as PetState) || [];
    
    // Resolve Timing
    let timing = resolveAnimationTiming(name, config);
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
    this.clock.play(name, timing, this.currentFrames.length, speed);
  }

  beginDistanceDriven(config: DistanceDrivenPlayback): void {
    this.clock.stop();
    this.playbackMode = 'distance';
    this.currentAnimation = config.animation;
    this.distanceConfig = config;
    this.currentFrames = this.loader.getFrames(config.animation as PetState) || [];
  }

  updateDistanceDriven(totalLogicalDistance: number): void {
    if (this.playbackMode !== 'distance' || !this.distanceConfig || this.currentFrames.length === 0) {
      return;
    }
    const { strideLengthPx } = this.distanceConfig;
    const frameCount = this.currentFrames.length;
    if (strideLengthPx <= 0 || frameCount === 0) return;

    const normalizedPhase = (Math.abs(totalLogicalDistance) % strideLengthPx) / strideLengthPx;
    const frameIndex = Math.min(frameCount - 1, Math.floor(normalizedPhase * frameCount));
    this.renderFrame(frameIndex);
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

  updateSpeedMultiplier(speed: number): void {
    this.clock.updateSpeedMultiplier(speed);
  }

  destroy(): void {
    this.clock.destroy();
    this.playbackMode = 'stopped';
    this.currentAnimation = null;
  }

  private renderFrame(frameIndex: number) {
    if (this.currentFrames.length === 0) return;

    let idx = frameIndex % this.currentFrames.length;
    let framePath = this.currentFrames[idx];

    let attempts = 0;
    while (this.badFrames.has(framePath) && attempts < this.currentFrames.length) {
      idx = (idx + 1) % this.currentFrames.length;
      framePath = this.currentFrames[idx];
      attempts++;
    }

    if (attempts >= this.currentFrames.length) {
      return;
    }

    if (!this.element.src.endsWith(framePath)) {
      this.element.src = framePath;
    }
  }
}
