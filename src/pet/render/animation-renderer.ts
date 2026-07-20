import { PetState, AnimationTiming } from '../../shared/character-types';

export interface AnimationPlaybackOptions {
  loop?: boolean;
  fallback?: string;
  timingOverride?: Partial<AnimationTiming>;
  onComplete?: (nextState: PetState) => void;
  speedMultiplier?: number;
}

export interface AnimationRenderer {
  load(): Promise<void>;
  hasAnimation(name: string): boolean;
  play(
    name: string,
    options?: AnimationPlaybackOptions
  ): Promise<void> | void;
  stop(): void;
  setFacing?(facing: "left" | "right"): void;
  resize?(width: number, height: number): void;
  updateSpeedMultiplier?(speed: number): void;
  destroy(): void;
}
