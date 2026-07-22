import { CharacterManifest } from '../shared/character-types';
import { validateCharacterManifest } from './character-validator';
import { invoke } from '@tauri-apps/api/core';
import {
  CharacterCapabilities,
  CharacterSource,
  CodexAdapterConfig,
  GeneralPetsExtrasConfig,
} from './codex/codex-types';
import { CodexCharacterAdapter } from './codex/codex-character-adapter';
import { resolveCharacterCapabilities } from './codex/character-capabilities';
import { applyVerifiedAdapterOverride } from './codex/verified-adapter-overrides';

export class CharacterLoader {
  private characterId: string;
  private config: CharacterManifest | null = null;
  private source: CharacterSource | null = null;
  private frameCache: Map<string, string[]> = new Map();
  private adapterConfig: CodexAdapterConfig | null = null;
  private extrasConfig: GeneralPetsExtrasConfig | null = null;
  private dialoguesCache: any = null;
  private interactionsCache: any = null;

  constructor(characterId: string = 'default') {
    this.characterId = characterId;
  }

  getConfig(): CharacterManifest | null {
    return this.config;
  }

  getAdapterConfig(): CodexAdapterConfig | null {
    return this.adapterConfig;
  }

  getExtrasConfig(): GeneralPetsExtrasConfig | null {
    return this.extrasConfig;
  }

  getCapabilities(): CharacterCapabilities {
    return resolveCharacterCapabilities(this.adapterConfig, this.extrasConfig);
  }

  getCharacterSource(): CharacterSource | null {
    return this.source;
  }

  getDialogues(): any {
    return this.dialoguesCache;
  }

  getInteractions(): any {
    return this.interactionsCache;
  }

  async load(): Promise<CharacterManifest> {
    try {
      this.source = await this.resolveSource(this.characterId);
      
      if (this.source.kind === 'builtin') {
        this.adapterConfig = null;
        this.extrasConfig = null;
        const res = await fetch(`${this.source.rootUrl}/character.json`);
        if (!res.ok) throw new Error(`Failed to load built-in character: ${res.statusText}`);
        const json = await res.json();
        if (!validateCharacterManifest(json)) {
          throw new Error("Built-in character manifest validation failed.");
        }
        this.config = json as CharacterManifest;
        this.dialoguesCache = null;
        this.interactionsCache = null;
        this.preloadAllFrames();
      } else {
        // Installed Codex V1 character
        console.log(`[CharacterLoader] Invoking load_installed_character_configs for ${this.characterId}`);
        const configs: any = await invoke('load_installed_character_configs', { id: this.characterId });
        console.log(`[CharacterLoader] load_installed_character_configs success for ${this.characterId}`);
        
        const petJson = configs.pet;
        const sourcePetId = typeof configs.adapter?.sourcePetId === 'string'
          ? configs.adapter.sourcePetId
          : (typeof petJson.id === 'string' ? petJson.id : this.characterId);
        const adapterWithVerifiedQa = applyVerifiedAdapterOverride(configs.adapter, sourcePetId);
        this.adapterConfig = CodexCharacterAdapter.normalizeCodexAdapterConfig(
          adapterWithVerifiedQa,
          sourcePetId,
        );
        this.extrasConfig = CodexCharacterAdapter.normalizeExtrasConfig(configs.extras);
        this.dialoguesCache = configs.dialogues;
        this.interactionsCache = configs.interactions;

        // Build virtual CharacterManifest
        this.config = {
          schemaVersion: 1,
          id: this.characterId,
          name: petJson.displayName || petJson.name || this.characterId,
          author: petJson.author || "Codex Import",
          version: petJson.version || "1.0.0",
          description: petJson.description || "",
          window: {
            width: 260,
            height: 300
          },
          render: {
            width: this.adapterConfig.render.frameWidth || 192,
            height: this.adapterConfig.render.frameHeight || 208,
            anchorX: 0.5,
            anchorY: 1,
            defaultScale: this.adapterConfig.render.defaultScale || 1
          },
          motion: {
            walkSpeed: 60,
            walkDurationMinMs: 1600,
            walkDurationMaxMs: 4200,
            landingOffset: 0,
            supportsHorizontalFlip: false // Walk rows are directional in Codex V1
          },
          animations: {
            // Placeholder frame configs just to satisfy the states validators
            idle: { path: "idle", fps: 4, loop: true, frames: ["1"] },
            happy: { path: "happy", fps: 8, loop: false, frames: ["1"] },
            angry: { path: "angry", fps: 8, loop: false, frames: ["1"] },
            dragged: { path: "dragged", fps: 1, loop: true, frames: ["1"] },
            sleep: { path: "sleep", fps: 3, loop: true, frames: ["1"] },
            wake: { path: "wake", fps: 6, loop: false, frames: ["1"] },
            walk: { path: "walk", fps: 6, loop: true, frames: ["1"] },
            sit: { path: "sit", fps: 2, loop: true, frames: ["1"] },
            falling: { path: "falling", fps: 4, loop: true, frames: ["1"] },
            landing: { path: "landing", fps: 6, loop: false, frames: ["1"] },
            shy: { path: "shy", fps: 6, loop: false, frames: ["1"] },
            surprised: { path: "surprised", fps: 8, loop: false, frames: ["1"] }
          },
          dialogues: "dialogues.json",
          interactions: "interactions.json"
        };
      }
      
      return this.config;
    } catch (e) {
      console.error('Error loading character, falling back to default:', e);
      if (this.characterId !== 'default') {
        this.characterId = 'default';
        return this.load();
      }
      throw e;
    }
  }

  private async resolveSource(id: string): Promise<CharacterSource> {
    if (id === 'default') {
      return { kind: 'builtin', id: 'default', rootUrl: '/characters/default' };
    }
    try {
      const installed: any[] = await invoke('list_installed_characters');
      const found = installed.find(c => c.id === id);
      if (found) {
        return { kind: 'installed', id, rootPath: found.absolutePath };
      }
    } catch (e) {
      console.warn('[CharacterLoader] list_installed_characters failed, fallback to default:', e);
    }
    return { kind: 'builtin', id: 'default', rootUrl: '/characters/default' };
  }

  private preloadAllFrames() {
    if (!this.config || this.source?.kind !== 'builtin') return;
    this.frameCache.clear();
    
    for (const [state, animConfig] of Object.entries(this.config.animations)) {
      if (!animConfig || !animConfig.frames) continue;
      const frames: string[] = [];
      for (const frameName of animConfig.frames) {
        frames.push(`${this.source.rootUrl}/${animConfig.path}/${frameName}`);
      }
      this.frameCache.set(state, frames);
      
      // Preload images
      frames.forEach(src => {
        const img = new Image();
        img.src = src;
      });
    }
  }

  getFrames(state: string): string[] {
    return this.frameCache.get(state) || [];
  }
}
