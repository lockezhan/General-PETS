export type PetState = 'idle' | 'happy' | 'angry' | 'dragged';

export interface AnimationConfig {
  path: string;
  frames: number;
  fps: number;
  loop: boolean;
  fallback?: PetState;
}

export interface CharacterConfig {
  id: string;
  name: string;
  version: number;
  window: {
    width: number;
    height: number;
  };
  render: {
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
  };
  animations: Partial<Record<PetState, AnimationConfig>>;
}

export interface PetSettings {
  characterId: string;
  windowX?: number;
  windowY?: number;
  alwaysOnTop: boolean;
  soundEnabled: boolean;
}
