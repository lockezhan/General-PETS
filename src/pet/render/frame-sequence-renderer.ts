import { AnimationRenderer, AnimationPlaybackOptions } from './animation-renderer';
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

  stop(): void {
    this.clock.stop();
  }

  updateSpeedMultiplier(speed: number): void {
    this.clock.updateSpeedMultiplier(speed);
  }

  destroy(): void {
    this.clock.destroy();
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
