import { AnimationTiming, AnimationConfig } from '../../shared/character-types';

export const DEFAULT_ANIMATION_TIMINGS: Record<string, AnimationTiming> = {
  idle: {
    frameDurationMs: 160,
    lastFrameDurationMs: 320,
    loop: true,
    loopDelayRangeMs: {
      min: 2200,
      max: 5200,
    },
  },
  walk: {
    frameDurationMs: 120,
    lastFrameDurationMs: 120,
    loop: true,
  },
  happy: {
    frameDurationMs: 140,
    lastFrameDurationMs: 320,
    loop: false,
    fallback: "idle",
  },
  angry: {
    frameDurationMs: 140,
    lastFrameDurationMs: 420,
    loop: false,
    fallback: "idle",
  },
  shy: {
    frameDurationMs: 160,
    lastFrameDurationMs: 420,
    loop: false,
    fallback: "idle",
  },
  surprised: {
    frameDurationMs: 130,
    lastFrameDurationMs: 360,
    loop: false,
    fallback: "idle",
  },
  sit: {
    frameDurationMs: 220,
    lastFrameDurationMs: 320,
    loop: true,
    loopDelayRangeMs: {
      min: 600,
      max: 1400,
    },
  },
  sleep: {
    frameDurationMs: 260,
    lastFrameDurationMs: 500,
    loop: true,
    loopDelayRangeMs: {
      min: 800,
      max: 1800,
    },
  },
  wake: {
    frameDurationMs: 150,
    lastFrameDurationMs: 280,
    loop: false,
    fallback: "idle",
  },
  falling: {
    frameDurationMs: 120,
    lastFrameDurationMs: 120,
    loop: true,
  },
  landing: {
    frameDurationMs: 120,
    lastFrameDurationMs: 300,
    loop: false,
    fallback: "idle",
  },
  dragged: {
    frameDurationMs: 140,
    lastFrameDurationMs: 140,
    loop: true,
  },
};

export function resolveAnimationTiming(stateName: string, customConfig?: AnimationConfig): AnimationTiming {
  const defaults = DEFAULT_ANIMATION_TIMINGS[stateName] || {
    frameDurationMs: 160,
    loop: true
  };

  if (customConfig?.timing) {
    return {
      ...defaults,
      ...customConfig.timing,
      loop: customConfig.timing.loop !== undefined ? customConfig.timing.loop : (customConfig.loop !== undefined ? customConfig.loop : defaults.loop),
      fallback: customConfig.timing.fallback || customConfig.fallback || defaults.fallback
    } as AnimationTiming;
  }

  // Fallback to fps
  let frameDuration = defaults.frameDurationMs;
  if (customConfig?.fps && customConfig.fps > 0) {
    frameDuration = 1000 / customConfig.fps;
  }

  return {
    ...defaults,
    frameDurationMs: frameDuration,
    loop: customConfig?.loop !== undefined ? customConfig.loop : defaults.loop,
    fallback: customConfig?.fallback || defaults.fallback
  };
}

export interface AnimationClockCallbacks {
  onFrameChange: (frameIndex: number) => void;
  onComplete: (fallbackState: string) => void;
}

export interface AnimationDebugStats {
  state: string;
  frameIndex: number;
  logicalFrameIndex: number;
  actualFrameIndex: number;
  configuredDurationMs: number;
  effectiveDurationMs: number;
  lastAdvanceAt: number;
  activeTimerCount: number;
}

export class AnimationClock {
  private onFrameChange: (frameIndex: number) => void;
  private onComplete: (fallbackState: string) => void;

  private stateName = '';
  private timing: AnimationTiming | null = null;
  private frameCount = 0;
  private speedMultiplier = 1.0;

  private logicalFrameIndex = 0;
  private actualFrameIndex = 0;
  private timerId: any = null;
  private isPaused = false;
  private isRunning = false;

  // For pause/resume and lag recovery
  private currentFrameDuration = 0;
  private lastStartTime = 0;
  private remainingTime = 0;
  private isDelayPeriod = false;

  // Debug stats
  private lastAdvanceAt = 0;

  constructor(callbacks: AnimationClockCallbacks) {
    this.onFrameChange = callbacks.onFrameChange;
    this.onComplete = callbacks.onComplete;
  }

  getDebugStats(): AnimationDebugStats {
    return {
      state: this.stateName,
      frameIndex: this.actualFrameIndex,
      logicalFrameIndex: this.logicalFrameIndex,
      actualFrameIndex: this.actualFrameIndex,
      configuredDurationMs: this.timing ? this.getCurrentFrameConfiguredDuration() : 0,
      effectiveDurationMs: this.currentFrameDuration,
      lastAdvanceAt: this.lastAdvanceAt,
      activeTimerCount: this.timerId ? 1 : 0
    };
  }

  play(stateName: string, timing: AnimationTiming, frameCount: number, speedMultiplier: number) {
    this.stop();

    this.stateName = stateName;
    this.frameCount = frameCount;
    const sequence = timing.frameSequence;
    const validSequence = sequence === undefined || (
      sequence.length > 0 &&
      sequence.length <= 32 &&
      sequence.every((index) => Number.isInteger(index) && index >= 0 && index < frameCount)
    );
    this.timing = validSequence ? timing : { ...timing, frameSequence: undefined };
    if (!validSequence) {
      console.warn(`[animation] invalid frameSequence for state=${stateName}; using atlas order`);
    }
    this.speedMultiplier = this.clampSpeed(speedMultiplier);
    this.logicalFrameIndex = 0;
    this.actualFrameIndex = this.resolveActualFrameIndex(0);
    this.isRunning = true;
    this.isPaused = false;
    this.isDelayPeriod = false;

    this.renderCurrentFrame();
    this.scheduleNextFrame();
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.isDelayPeriod = false;
    this.clearTimer("stop");
  }

  pause() {
    if (!this.isRunning || this.isPaused) return;
    
    this.isPaused = true;
    const elapsed = performance.now() - this.lastStartTime;
    this.remainingTime = Math.max(0, this.currentFrameDuration - elapsed);
    
    this.clearTimer("pause");
  }

  resume() {
    if (!this.isRunning || !this.isPaused) return;

    this.isPaused = false;
    this.lastStartTime = performance.now();
    this.currentFrameDuration = this.remainingTime;
    
    this.clearTimer("resume-pre");
    this.timerId = setTimeout(this.onTick, this.currentFrameDuration);
    this.logDebug(`resumed with remaining=${this.currentFrameDuration.toFixed(1)}ms`);
  }

  updateSpeedMultiplier(speedMultiplier: number) {
    const oldMultiplier = this.speedMultiplier;
    this.speedMultiplier = this.clampSpeed(speedMultiplier);
    
    if (this.isRunning && !this.isPaused && !this.isDelayPeriod && oldMultiplier !== this.speedMultiplier) {
      this.logDebug(`speed-multiplier=${this.speedMultiplier}`);
      // Recalculate remaining time for active frame under new speed multiplier
      const elapsed = performance.now() - this.lastStartTime;
      const baseRemaining = (this.currentFrameDuration - elapsed) * oldMultiplier;
      
      const newRemaining = Math.max(40, baseRemaining / this.speedMultiplier);
      this.clearTimer("speed-change");
      
      this.lastStartTime = performance.now();
      this.currentFrameDuration = newRemaining;
      this.timerId = setTimeout(this.onTick, this.currentFrameDuration);
    }
  }

  destroy() {
    this.stop();
  }

  private clampSpeed(speed: number): number {
    if (isNaN(speed)) return 1.0;
    return Math.max(0.5, Math.min(1.5, speed));
  }

  private renderCurrentFrame() {
    this.lastAdvanceAt = performance.now();
    this.actualFrameIndex = this.resolveActualFrameIndex(this.logicalFrameIndex);
    this.onFrameChange(this.actualFrameIndex);
  }

  private getCurrentFrameConfiguredDuration(): number {
    if (!this.timing) return 100;
    
    // 1. Check array duration
    const logicalFrameCount = this.getLogicalFrameCount();
    if (this.timing.frameDurationsMs && this.timing.frameDurationsMs.length === logicalFrameCount) {
      return this.timing.frameDurationsMs[this.logicalFrameIndex];
    }
    
    // 2. Check last frame duration
    if (this.logicalFrameIndex === logicalFrameCount - 1 && this.timing.lastFrameDurationMs !== undefined) {
      return this.timing.lastFrameDurationMs;
    }

    // 3. Fallback
    return this.timing.frameDurationMs;
  }

  private scheduleNextFrame() {
    if (!this.isRunning || this.isPaused || !this.timing) return;

    this.clearTimer("schedule");

    this.isDelayPeriod = false;
    const baseDuration = this.getCurrentFrameConfiguredDuration();
    
    // Clamping base frame duration: 40ms to 5000ms
    const clampedBase = Math.max(40, Math.min(5000, baseDuration));
    
    // Apply speed multiplier
    this.currentFrameDuration = clampedBase / this.speedMultiplier;
    
    this.lastStartTime = performance.now();
    this.timerId = setTimeout(this.onTick, this.currentFrameDuration);
    
    this.logDebug(`state=${this.stateName} logicalFrame=${this.logicalFrameIndex} actualFrame=${this.actualFrameIndex} duration=${this.currentFrameDuration.toFixed(1)}ms`);
  }

  private onTick = () => {
    this.timerId = null;
    if (!this.isRunning || this.isPaused || !this.timing) return;

    if (this.isDelayPeriod) {
      // Loop delay ended, start a new loop
      this.logicalFrameIndex = 0;
      this.renderCurrentFrame();
      this.scheduleNextFrame();
      return;
    }

    // Standard frame tick
    const logicalFrameCount = this.getLogicalFrameCount();
    if (this.logicalFrameIndex < logicalFrameCount - 1) {
      this.logicalFrameIndex++;
      this.renderCurrentFrame();
      this.scheduleNextFrame();
    } else {
      // Last frame finished
      if (this.timing.loop) {
        // Find hold frame index
        let holdIndex = this.timing.holdFrameIndex !== undefined ? this.timing.holdFrameIndex : 0;
        if (holdIndex < 0 || holdIndex >= this.frameCount) {
          holdIndex = 0;
        }
        
        // Calculate loop delay
        let delayMs = 0;
        if (this.timing.loopDelayRangeMs) {
          const min = Math.max(0, this.timing.loopDelayRangeMs.min);
          const max = Math.max(min, this.timing.loopDelayRangeMs.max);
          delayMs = Math.random() * (max - min) + min;
        } else if (this.timing.loopDelayMs !== undefined) {
          delayMs = Math.max(0, this.timing.loopDelayMs);
        }

        if (delayMs > 0) {
          this.logicalFrameIndex = holdIndex;
          this.renderCurrentFrame();
          
          this.isDelayPeriod = true;
          this.currentFrameDuration = delayMs; // Delay is not multiplied by speedMultiplier
          this.lastStartTime = performance.now();
          this.timerId = setTimeout(this.onTick, this.currentFrameDuration);
          
          this.logDebug(`state=${this.stateName} loop-delay=${this.currentFrameDuration.toFixed(1)}ms`);
        } else {
          // Loop immediately
          this.logicalFrameIndex = 0;
          this.renderCurrentFrame();
          this.scheduleNextFrame();
        }
      } else {
        // Non-loop complete
        const fallback = this.timing.fallback || 'idle';
        this.isRunning = false;
        this.onComplete(fallback);
      }
    }
  };

  private getLogicalFrameCount(): number {
    return this.timing?.frameSequence?.length ?? this.frameCount;
  }

  private resolveActualFrameIndex(logicalFrameIndex: number): number {
    const sequence = this.timing?.frameSequence;
    if (!sequence) return logicalFrameIndex;
    return sequence[logicalFrameIndex] ?? 0;
  }

  private clearTimer(reason: string) {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
      this.logDebug(`stopped reason=${reason}`);
    }
  }

  private logDebug(msg: string) {
    if ((import.meta as any).env?.DEV) {
      console.log(`[animation] ${msg}`);
    }
  }
}
