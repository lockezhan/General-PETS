import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAtlasRenderer } from '../pet/render/codex-atlas-renderer';
import { CharacterLoader } from '../pet/character-loader';
import { CodexAdapterConfig } from '../pet/codex/codex-types';

// Mock Tauri core APIs
vi.mock('@tauri-apps/api/core', () => {
  return {
    convertFileSrc: (path: string) => `asset://localhost/${path.replace(/\\/g, '/')}`,
    invoke: vi.fn().mockImplementation((cmd) => {
      if (cmd === 'list_installed_characters') {
        return Promise.resolve([
          {
            id: 'codex-gugagaga',
            sourceType: 'codex-v1',
            sourcePetId: 'gugagaga',
            displayName: 'Gugagaga',
            directory: 'codex-gugagaga',
            installedAt: '2026-07-20T12:00:00Z',
            absolutePath: 'C:\\Users\\elite\\AppData\\Local\\general-pets\\characters\\codex-gugagaga'
          }
        ]);
      }
      if (cmd === 'load_installed_character_configs') {
        return Promise.resolve({
          adapter: {
            schemaVersion: 1,
            sourceType: 'codex-v1',
            sourcePetId: 'gugagaga',
            spriteVersionNumber: 1,
            render: {
              frameWidth: 220,
              frameHeight: 238,
              defaultScale: 1
            }
          },
          pet: {
            displayName: 'Gugagaga Slime',
            description: 'A cute test slime'
          },
          dialogues: {
            idle: ["hello"]
          },
          interactions: {
            schemaVersion: 1,
            hitAreas: []
          }
        });
      }
      return Promise.resolve(null);
    })
  };
});

describe('CodexAtlasRenderer', () => {
  let element: HTMLImageElement;
  let adapterConfig: CodexAdapterConfig;

  beforeEach(() => {
    element = document.createElement('img');
    adapterConfig = {
      schemaVersion: 1,
      sourceType: 'codex-v1',
      sourcePetId: 'gugagaga',
      spriteVersionNumber: 1,
      render: {
        frameWidth: 192,
        frameHeight: 208,
        defaultScale: 1
      },
      animationMapping: {
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
        surprised: 'review'
      },
      interactionMode: 'whole-sprite-default'
    };
  });

  it('should wrap element in viewport container and configure absolute position style', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);

    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);
    
    // Viewport should be created and inserted
    const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;
    expect(viewport).toBeDefined();
    expect(viewport.style.overflow).toBe('hidden');
    expect(viewport.style.position).toBe('relative');

    // Sprite image styles
    expect(element.style.position).toBe('absolute');
    expect(element.style.maxWidth).toBe('none');

    renderer.destroy();
    
    // Cleaned up
    expect(parent.querySelector('.codex-frame-viewport')).toBeNull();
    expect(element.style.position).toBe('');
  });

  it('should compute transform translations based on column and row scaling factors', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);

    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);

    // Mock bounding rect for display size
    const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 192, 208));

    // Play waving row 3
    renderer.play('happy', { loop: false });

    // Expect initial offset col=0, row=3
    // scaleX = 192/192 = 1, scaleY = 208/208 = 1
    // transform translate(0px, -624px) -> row 3 * 208 = 624
    expect(element.style.transform).toBe('translate(0px, -624px)');

    renderer.destroy();
  });
});

describe('CharacterLoader with Codex installed pets', () => {
  it('should resolve Installed source and load virtual manifest successfully', async () => {
    const loader = new CharacterLoader('codex-gugagaga');

    const manifest = await loader.load();

    expect(manifest.id).toBe('codex-gugagaga');
    expect(manifest.name).toBe('Gugagaga Slime');
    expect(manifest.render.width).toBe(220);
    expect(manifest.render.height).toBe(238);
    expect(loader.getCharacterSource()?.kind).toBe('installed');
    expect(loader.getDialogues()?.idle[0]).toBe('hello');
  });
});
