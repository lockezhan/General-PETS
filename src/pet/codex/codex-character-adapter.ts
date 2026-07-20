import { CodexAdapterConfig, CodexAnimationMapping } from './codex-types';

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

    return {
      schemaVersion,
      sourceType,
      sourcePetId,
      spriteVersionNumber,
      render,
      animationMapping,
      interactionMode,
    };
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
