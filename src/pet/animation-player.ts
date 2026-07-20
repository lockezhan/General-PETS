import { AnimationConfig, PetState } from '../shared/character-types';
import { CharacterLoader } from './character-loader';

export class AnimationPlayer {
  private loader: CharacterLoader;
  private currentFrameIndex = 0;
  private currentAnimation: AnimationConfig | null = null;
  private currentState: PetState = 'idle';
  private lastFrameTime = 0;
  private isPlaying = false;
  private element: HTMLImageElement;
  private animationFrameId = 0;
  private onAnimationEnd: ((state: PetState) => void) | null = null;
  
  private badFrames: Set<string> = new Set();

  constructor(loader: CharacterLoader, element: HTMLImageElement) {
    this.loader = loader;
    this.element = element;
    
    this.element.onerror = () => {
      if (this.element.src) {
        const url = new URL(this.element.src);
        this.badFrames.add(url.pathname);
      }
      this.advanceFrame();
    };
  }

  play(state: PetState, config: AnimationConfig, onEnd?: (s: PetState) => void) {
    this.currentState = state;
    this.currentAnimation = config;
    this.currentFrameIndex = 0;
    this.onAnimationEnd = onEnd || null;
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    
    this.renderFrame();
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.loop();
  }

  private loop = () => {
    if (!this.isPlaying || !this.currentAnimation) return;

    const now = performance.now();
    const frameDuration = 1000 / this.currentAnimation.fps;

    if (now - this.lastFrameTime >= frameDuration) {
      this.lastFrameTime = now;
      this.advanceFrame();
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  };
  
  private advanceFrame() {
    if (!this.isPlaying || !this.currentAnimation) return;
    
    this.currentFrameIndex++;
    
    const frames = this.loader.getFrames(this.currentState);
    const validFrames = frames.filter(f => !this.badFrames.has(f));
    
    if (validFrames.length === 0) {
      this.fallback();
      return;
    }

    if (this.currentFrameIndex >= this.currentAnimation.frames.length) {
      if (this.currentAnimation.loop) {
        this.currentFrameIndex = 0;
      } else {
        this.fallback();
        return;
      }
    }
    this.renderFrame();
  }
  
  private fallback() {
    this.isPlaying = false;
    const fallback = this.currentAnimation?.fallback || 'idle';
    if (this.onAnimationEnd) this.onAnimationEnd(fallback);
  }

  private renderFrame() {
    const frames = this.loader.getFrames(this.currentState);
    if (frames && frames.length > 0) {
      let framePath = frames[this.currentFrameIndex % frames.length];
      
      let attempts = 0;
      while (this.badFrames.has(framePath) && attempts < frames.length) {
        this.currentFrameIndex++;
        framePath = frames[this.currentFrameIndex % frames.length];
        attempts++;
      }
      
      if (attempts >= frames.length) {
        this.fallback();
        return;
      }
      
      if (!this.element.src.endsWith(framePath)) {
        this.element.src = framePath;
      }
    } else {
       this.fallback();
    }
  }

  stop() {
    this.isPlaying = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
  }
}
