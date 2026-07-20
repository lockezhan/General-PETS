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

  public static async load(rootPath: string, sourcePetId: string): Promise<CodexAdapterConfig> {
    try {
      // In web app, we can read the file using fetch or from Tauri FS command if needed.
      // Since installed characters are in AppLocalData, we can resolve their adapter path.
      // Wait, we can fetch it via the custom asset protocol / URL!
      // Let's resolve the path using convertFileSrc, or fetch it.
      // Wait, if it is in AppLocalData, how do we load files?
      // We can use tauri-plugin-store or a fetch. Since convertFileSrc maps AppLocalData to a URL,
      // we can fetch the URL of 'general-pets.adapter.json' directly!
      const adapterUrl = `${rootPath}/general-pets.adapter.json`;
      const res = await fetch(adapterUrl);
      if (res.ok) {
        const json = await res.json();
        if (json && json.schemaVersion === 1) {
          return json as CodexAdapterConfig;
        }
      }
    } catch (e) {
      console.warn('[codex-adapter] Failed to load adapter config, generating default:', e);
    }
    return this.createDefaultConfig(sourcePetId);
  }
}
