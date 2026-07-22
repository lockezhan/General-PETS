import type { CodexV1AnimationName } from './codex-atlas-contract';

export interface CodexPetManifest {
  id: string;
  displayName: string;
  description?: string;
  spritesheetPath: string;
  spriteVersionNumber: 1 | 2;
}

export interface CodexScanResult {
  sourcePath: string;
  status: "valid" | "invalid" | "unsupported-version" | "missing-spritesheet";
  manifest?: CodexPetManifest;
  previewUrl?: string;
  previewCachePath?: string;
  errors: string[];
  warnings: string[];
}

export interface InstalledCharacter {
  id: string;
  sourceType: "codex-v1";
  sourcePetId: string;
  displayName: string;
  description?: string;
  directory: string;
  previewPath: string;
  installedAt: string;
  absolutePath: string;
  spriteVersionNumber: number;
}

export interface InstalledIndex {
  schemaVersion: number;
  characters: InstalledCharacter[];
}

export type CharacterSource =
  | {
      kind: "builtin";
      id: string;
      rootUrl: string;
    }
  | {
      kind: "installed";
      id: string;
      rootPath: string;
    };

export interface CodexAnimationMapping {
  idle: CodexV1AnimationName;
  walkLeft: CodexV1AnimationName;
  walkRight: CodexV1AnimationName;
  happy: CodexV1AnimationName;
  angry: CodexV1AnimationName;
  sleep: CodexV1AnimationName;
  sit: CodexV1AnimationName;
  wake: CodexV1AnimationName;
  falling: CodexV1AnimationName;
  landing: CodexV1AnimationName;
  dragged: CodexV1AnimationName;
  shy: CodexV1AnimationName;
  surprised: CodexV1AnimationName;

  waving?: CodexV1AnimationName;
  jumping?: CodexV1AnimationName;
  failed?: CodexV1AnimationName;
  waiting?: CodexV1AnimationName;
  running?: CodexV1AnimationName;
  review?: CodexV1AnimationName;
}

export type LookDirectionName =
  | "center"
  | "up"
  | "upperRight"
  | "right"
  | "lowerRight"
  | "down"
  | "lowerLeft"
  | "left"
  | "upperLeft";

export interface AtlasCellReference {
  row: number;
  column: number;
}

export type CodexLookDirections = Record<LookDirectionName, AtlasCellReference>;

export interface GeneralPetsExtrasAnimation {
  row: number;
  frameCount: number;
  frameSequence: number[];
  frameDurationsMs: number[];
}

export interface GeneralPetsExtrasConfig {
  schemaVersion: 1;
  spritesheetPath: string;
  frameWidth: number;
  frameHeight: number;
  animations: {
    lookAround?: GeneralPetsExtrasAnimation;
  };
}

export interface CharacterCapabilities {
  supportsLookAround: boolean;
  lookAroundSource: "codex-v2" | "general-pets-extras" | null;
}

export interface CodexAdapterConfig {
  schemaVersion: number;
  sourceType: "codex-v1";
  sourcePetId: string;
  spriteVersionNumber: 1 | 2;
  render: {
    frameWidth: number;
    frameHeight: number;
    defaultScale: number;
  };
  animationMapping: CodexAnimationMapping;
  animationSequences?: Partial<Record<CodexV1AnimationName, number[]>>;
  lookDirections?: CodexLookDirections;
  locomotion?: {
    walkStrideLengthPx: number;
    dragStrideLengthPx: number;
    runStrideLengthPx: number;
  };
  interactionMode: "whole-sprite-default";
}
