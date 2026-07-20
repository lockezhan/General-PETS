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
  idle: string;
  walkLeft: string;
  walkRight: string;
  happy: string;
  angry: string;
  sleep: string;
  sit: string;
  wake: string;
  falling: string;
  landing: string;
  dragged: string;
  shy: string;
  surprised: string;
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
  interactionMode: "whole-sprite-default";
}
