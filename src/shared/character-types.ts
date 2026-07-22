export type BuiltInPetState =
  | "idle"
  | "happy"
  | "angry"
  | "dragged"
  | "sleep"
  | "wake"
  | "walk"
  | "sit"
  | "falling"
  | "landing";

export type PetState = BuiltInPetState | string;

export interface AnimationTiming {
  frameDurationMs: number;
  /** Logical playback order. Values remain atlas/frame-array indices. */
  frameSequence?: number[];
  frameDurationsMs?: number[];
  lastFrameDurationMs?: number;
  loopDelayMs?: number;
  loopDelayRangeMs?: {
    min: number;
    max: number;
  };
  loop: boolean;
  fallback?: string;
  holdFrameIndex?: number;
}

export interface AnimationConfig {
  path: string;
  fps: number;
  loop: boolean;
  frames: string[];
  fallback?: PetState;
  timing?: Partial<AnimationTiming>;
}

export interface MotionConfig {
  walkSpeed: number;
  walkDurationMinMs: number;
  walkDurationMaxMs: number;
  idleDelayMinMs: number;
  idleDelayMaxMs: number;
  landingOffset: number;
  supportsHorizontalFlip: boolean;
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  walkSpeed: 48,
  walkDurationMinMs: 1600,
  walkDurationMaxMs: 4200,
  idleDelayMinMs: 12000,
  idleDelayMaxMs: 35000,
  landingOffset: 0,
  supportsHorizontalFlip: true,
};

export interface CharacterManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  author?: string;
  version: string;
  description?: string;
  preview?: string;
  icon?: string;
  window: {
    width: number;
    height: number;
  };
  render: {
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
    defaultScale: number;
  };
  motion?: Partial<MotionConfig>;
  animations: Record<string, AnimationConfig>;
  dialogues?: string;
  interactions?: string;
  spritesheetPath?: string;
}
