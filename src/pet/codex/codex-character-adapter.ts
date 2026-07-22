import {
  CodexAdapterConfig,
  CodexAnimationMapping,
  CodexLookDirections,
  GeneralPetsExtrasConfig,
  LookDirectionName,
} from './codex-types';
import { CODEX_BASE_ANIMATIONS, CodexV1AnimationName } from './codex-atlas-contract';

export const DEFAULT_ANIMATION_MAPPING: CodexAnimationMapping = {
  idle: 'idle',
  walkLeft: 'running-left',
  walkRight: 'running-right',
  happy: 'waving',
  angry: 'failed',
  sleep: 'waiting',
  sit: 'waiting',
  wake: 'waving',
  falling: 'jumping',
  landing: 'jumping',
  dragged: 'jumping',
  shy: 'review',
  surprised: 'review',
  waving: 'waving',
  jumping: 'jumping',
  failed: 'failed',
  waiting: 'waiting',
  running: 'running',
  review: 'review',
};

export class CodexCharacterAdapter {
  public static createDefaultConfig(sourcePetId: string): CodexAdapterConfig {
    return {
      schemaVersion: 1,
      sourceType: 'codex-v1',
      sourcePetId,
      spriteVersionNumber: 1,
      render: {
        frameWidth: 192,
        frameHeight: 208,
        defaultScale: 1,
      },
      animationMapping: { ...DEFAULT_ANIMATION_MAPPING },
      locomotion: {
        walkStrideLengthPx: 72,
        dragStrideLengthPx: 72,
        runStrideLengthPx: 88,
      },
      interactionMode: 'whole-sprite-default',
    };
  }

  public static normalizeCodexAdapterConfig(raw: any, sourcePetId: string): CodexAdapterConfig {
    const defaultConfig = this.createDefaultConfig(sourcePetId);
    if (!raw || typeof raw !== 'object') {
      console.warn(`[codex-adapter] Invalid raw config for ${sourcePetId}, using default.`);
      return defaultConfig;
    }

    const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : defaultConfig.schemaVersion;
    const sourceType = raw.sourceType === 'codex-v1' ? raw.sourceType : defaultConfig.sourceType;
    const spriteVersionNumber = (raw.spriteVersionNumber === 1 || raw.spriteVersionNumber === 2) 
      ? raw.spriteVersionNumber 
      : defaultConfig.spriteVersionNumber;

    const render = {
      frameWidth: typeof raw.render?.frameWidth === 'number' ? raw.render.frameWidth : defaultConfig.render.frameWidth,
      frameHeight: typeof raw.render?.frameHeight === 'number' ? raw.render.frameHeight : defaultConfig.render.frameHeight,
      defaultScale: typeof raw.render?.defaultScale === 'number' ? raw.render.defaultScale : defaultConfig.render.defaultScale,
    };

    const interactionMode = raw.interactionMode === 'whole-sprite-default' ? raw.interactionMode : defaultConfig.interactionMode;
    const clampStride = (value: unknown, fallback: number, min: number, max: number) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, value))
        : fallback;
    const locomotion = {
      walkStrideLengthPx: clampStride(raw.locomotion?.walkStrideLengthPx, defaultConfig.locomotion!.walkStrideLengthPx, 32, 192),
      dragStrideLengthPx: clampStride(raw.locomotion?.dragStrideLengthPx, defaultConfig.locomotion!.dragStrideLengthPx, 32, 192),
      runStrideLengthPx: clampStride(raw.locomotion?.runStrideLengthPx, defaultConfig.locomotion!.runStrideLengthPx, 32, 240),
    };

    // 检查 animationMapping
    let animationMapping: CodexAnimationMapping = { ...DEFAULT_ANIMATION_MAPPING };
    if (raw.animationMapping && typeof raw.animationMapping === 'object') {
      animationMapping = { ...DEFAULT_ANIMATION_MAPPING, ...raw.animationMapping };
    }

    const standardWalkLeft = "running-left";
    const standardWalkRight = "running-right";

    // 校验 walkLeft 和 walkRight
    const wl = animationMapping.walkLeft;
    const wr = animationMapping.walkRight;
    let needsFix = false;

    if (!wl || !wr || wl === wr || wl !== standardWalkLeft || wr !== standardWalkRight) {
      needsFix = true;
      console.warn(
        `[codex-adapter] Walk animations mapping anomaly for character '${sourcePetId}': ` +
        `walkLeft='${wl}', walkRight='${wr}'. Correcting to walkLeft='${standardWalkLeft}', walkRight='${standardWalkRight}'.`
      );
      animationMapping.walkLeft = standardWalkLeft;
      animationMapping.walkRight = standardWalkRight;
    }

    if (needsFix) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('repair_installed_codex_adapters').catch((err) => {
          console.error('[codex-adapter] Failed to trigger repair_installed_codex_adapters:', err);
        });
      }).catch(() => {});
    }

    const animationSequences: Partial<Record<CodexV1AnimationName, number[]>> = {};
    if (raw.animationSequences && typeof raw.animationSequences === 'object') {
      for (const animation of Object.keys(CODEX_BASE_ANIMATIONS) as CodexV1AnimationName[]) {
        const sequence = raw.animationSequences[animation];
        if (sequence === undefined) continue;
        const frameCount = CODEX_BASE_ANIMATIONS[animation].frameCount;
        if (this.isValidFrameSequence(sequence, frameCount)) {
          animationSequences[animation] = [...sequence];
        } else {
          console.warn(
            `[codex-adapter] Invalid frame sequence for '${sourcePetId}/${animation}', using atlas order.`
          );
        }
      }
    }

    const lookDirections = spriteVersionNumber === 2
      ? this.normalizeLookDirections(raw.lookDirections)
      : undefined;

    return {
      schemaVersion,
      sourceType,
      sourcePetId,
      spriteVersionNumber,
      render,
      animationMapping,
      ...(Object.keys(animationSequences).length > 0 ? { animationSequences } : {}),
      ...(lookDirections ? { lookDirections } : {}),
      locomotion,
      interactionMode,
    };
  }

  public static normalizeExtrasConfig(raw: unknown): GeneralPetsExtrasConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, any>;
    const lookAround = value.animations?.lookAround;
    if (
      value.schemaVersion !== 1 ||
      typeof value.spritesheetPath !== 'string' ||
      !value.spritesheetPath.trim() ||
      !Number.isInteger(value.frameWidth) || value.frameWidth <= 0 ||
      !Number.isInteger(value.frameHeight) || value.frameHeight <= 0 ||
      !lookAround || !Number.isInteger(lookAround.row) || lookAround.row < 0 ||
      !Number.isInteger(lookAround.frameCount) || lookAround.frameCount <= 0 ||
      !this.isValidFrameSequence(lookAround.frameSequence, lookAround.frameCount) ||
      !Array.isArray(lookAround.frameDurationsMs) ||
      lookAround.frameDurationsMs.length !== lookAround.frameSequence.length ||
      lookAround.frameDurationsMs.some((duration: unknown) =>
        typeof duration !== 'number' || !Number.isFinite(duration) || duration < 40 || duration > 5000
      )
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      spritesheetPath: value.spritesheetPath,
      frameWidth: value.frameWidth,
      frameHeight: value.frameHeight,
      animations: {
        lookAround: {
          row: lookAround.row,
          frameCount: lookAround.frameCount,
          frameSequence: [...lookAround.frameSequence],
          frameDurationsMs: [...lookAround.frameDurationsMs],
        },
      },
    };
  }

  private static isValidFrameSequence(value: unknown, frameCount: number): value is number[] {
    return Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 32 &&
      value.every((index) => Number.isInteger(index) && index >= 0 && index < frameCount);
  }

  private static normalizeLookDirections(value: unknown): CodexLookDirections | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const names: LookDirectionName[] = [
      'center', 'up', 'upperRight', 'right', 'lowerRight',
      'down', 'lowerLeft', 'left', 'upperLeft',
    ];
    const normalized = {} as CodexLookDirections;
    for (const name of names) {
      const cell = (value as Record<string, any>)[name];
      if (
        !cell || !Number.isInteger(cell.row) || !Number.isInteger(cell.column) ||
        cell.row < 0 || cell.row > 10 || cell.column < 0 || cell.column > 7
      ) {
        return undefined;
      }
      normalized[name] = { row: cell.row, column: cell.column };
    }
    return normalized;
  }

  public static async load(rootPath: string, sourcePetId: string): Promise<CodexAdapterConfig> {
    try {
      const adapterUrl = `${rootPath}/general-pets.adapter.json`;
      const res = await fetch(adapterUrl);
      if (res.ok) {
        const json = await res.json();
        return this.normalizeCodexAdapterConfig(json, sourcePetId);
      }
    } catch (e) {
      console.warn('[codex-adapter] Failed to load adapter config, generating default:', e);
    }
    return this.createDefaultConfig(sourcePetId);
  }
}
