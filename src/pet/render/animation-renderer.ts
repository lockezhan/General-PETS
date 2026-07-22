import { PetState, AnimationTiming } from '../../shared/character-types';

export interface AnimationPlaybackOptions {
  loop?: boolean;
  fallback?: string;
  timingOverride?: Partial<AnimationTiming>;
  onComplete?: (nextState: PetState) => void;
  speedMultiplier?: number;
}

export interface DistanceDrivenPlayback {
  animation: string;
  frameCount: number;
  strideLengthPx: number;
  frameOffset?: number;
}

export interface AnimationRenderer {
  load(): Promise<void>;

  hasAnimation(name: string): boolean;

  play(name: string, options?: AnimationPlaybackOptions): Promise<void> | void;

  /**
   * 进入位移驱动模式。
   * 该模式不使用 AnimationClock 自动推进帧。
   */
  beginDistanceDriven(config: DistanceDrivenPlayback): void;

  /**
   * 根据累计逻辑位移显示指定动作帧。
   */
  updateDistanceDriven(totalLogicalDistance: number): void;

  endDistanceDriven(fallback?: string): void;

  stop(): void;

  getCurrentAnimation(): string | null;

  getPlaybackMode(): "clock" | "distance" | "stopped";

  setFacing?(facing: "left" | "right"): void;
  resize?(width: number, height: number): void;
  updateSpeedMultiplier?(speed: number): void;
  destroy(): void;
}
