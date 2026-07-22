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

  it('should wrap element in viewport container with Canvas 2D precision crop element', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);

    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);
    
    // Viewport and Canvas should be created and inserted
    const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;
    expect(viewport).toBeDefined();
    expect(viewport.style.overflow).toBe('hidden');
    expect(viewport.style.position).toBe('relative');

    const canvas = viewport.querySelector('canvas.codex-frame-canvas') as HTMLCanvasElement;
    expect(canvas).toBeDefined();
    expect(canvas.style.display).toBe('block');

    // Element style should be transparent in layout to let Canvas render & keep bounds
    expect(element.style.opacity).toBe('0');

    renderer.destroy();
    
    // Cleaned up
    expect(parent.querySelector('.codex-frame-viewport')).toBeNull();
    expect(element.style.display).toBe('');
  });

  it('should support distance-driven locomotion playback mode and calculate frames', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);

    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);

    renderer.beginDistanceDriven({
      animation: 'walkRight',
      frameCount: 8,
      strideLengthPx: 72
    });

    expect(renderer.getPlaybackMode()).toBe('distance');
    expect(renderer.getCurrentAnimation()).toBe('walkRight');

    renderer.updateDistanceDriven(36); // Half stride -> phase 0.5 -> frame 4
    expect((renderer as any).currentFrameIndex).toBe(4);

    renderer.updateDistanceDriven(72); // Full stride -> phase 0 -> frame 0
    expect((renderer as any).currentFrameIndex).toBe(0);

    renderer.updateDistanceDriven(288); // Four full 72px gait cycles -> frame 0
    expect((renderer as any).currentFrameIndex).toBe(0);

    renderer.endDistanceDriven('idle');
    expect(renderer.getPlaybackMode()).toBe('clock');
    expect(renderer.getCurrentAnimation()).toBe('idle');

    renderer.destroy();
  });

  it.each([
    ['walkLeft', 'running-left'],
    ['walkRight', 'running-right'],
    ['running-left', 'running-left'],
    ['running-right', 'running-right']
  ] as const)(
    'should resolve distance-driven %s to %s',
    (animation, mappedAnimation) => {
      const parent = document.createElement('div');
      parent.appendChild(element);
      const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);

      renderer.beginDistanceDriven({
        animation,
        frameCount: 8,
        strideLengthPx: 72
      });

      expect(renderer.getPlaybackMode()).toBe('distance');
      expect((renderer as any).currentMappedAnimation).toBe(mappedAnimation);
      renderer.destroy();
    }
  );

  it('should play walkRight and set currentMappedAnimation to running-right without viewport mirror', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);
    const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;

    renderer.play('walkRight');
    expect((renderer as any).currentMappedAnimation).toBe('running-right');
    expect(viewport.style.transform).toBe('none');

    renderer.destroy();
  });

  it('should play walkLeft and set currentMappedAnimation to running-left without viewport mirror', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);
    const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;

    renderer.play('walkLeft');
    expect((renderer as any).currentMappedAnimation).toBe('running-left');
    expect(viewport.style.transform).toBe('none');

    renderer.destroy();
  });

  it('should play standard running names directly on their Codex rows', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);

    renderer.play('running-left');
    expect((renderer as any).currentMappedAnimation).toBe('running-left');
    expect((renderer as any).currentConfig.row).toBe(2);

    renderer.play('running-right');
    expect((renderer as any).currentMappedAnimation).toBe('running-right');
    expect((renderer as any).currentConfig.row).toBe(1);

    renderer.destroy();
  });

  it('should not mirror viewport when facing is left for directional or non-directional animations', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);
    const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;

    renderer.setFacing('left');
    renderer.play('walkLeft');
    expect(viewport.style.transform).toBe('none');

    renderer.play('idle');
    // Canvas handles internal context mirroring, viewport transform stays 'none' to avoid double-mirroring
    expect(viewport.style.transform).toBe('none');

    renderer.destroy();
  });

  it('should render the first frame immediately when distance playback begins', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);
    const renderSpy = vi.spyOn(renderer, 'renderFrame');

    renderer.beginDistanceDriven({
      animation: 'walkLeft',
      frameCount: 8,
      strideLengthPx: 120
    });

    expect(renderSpy).toHaveBeenCalled();
    expect((renderer as any).currentFrameIndex).toBe(0);
    renderer.destroy();
  });

  it('should support version 2 adapters with 11 rows', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const v2Adapter = { ...adapterConfig, spriteVersionNumber: 2 as const };
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', v2Adapter);
    const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;

    renderer.play('idle');
    expect(viewport).toBeDefined();

    renderer.destroy();
  });

  it('should accept both Codex standard names and General-PETS logical names', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);

    for (const name of [
      'idle',
      'running-left',
      'running-right',
      'waving',
      'jumping',
      'failed',
      'waiting',
      'running',
      'review',
      'happy',
      'angry',
      'sleep',
      'sit',
      'falling',
      'landing',
      'shy'
    ]) {
      expect(renderer.hasAnimation(name), name).toBe(true);
    }

    renderer.destroy();
  });

  it.each([
    ['waving', 3],
    ['jumping', 4],
    ['failed', 5],
    ['waiting', 6],
    ['running', 7],
    ['review', 8]
  ] as const)('should play %s from atlas row %i', (animation, row) => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);

    renderer.play(animation);

    expect((renderer as any).currentMappedAnimation).toBe(animation);
    expect((renderer as any).currentConfig.row).toBe(row);
    renderer.destroy();
  });

  it.each([0.5, 0.75, 1, 1.25, 1.5])(
    'should synchronize viewport, canvas and hidden element at %sx scale',
    (scale) => {
      const parent = document.createElement('div');
      parent.appendChild(element);
      const renderer = new CodexAtlasRenderer(element, 'asset://localhost/spritesheet.webp', adapterConfig);
      const viewport = parent.querySelector('.codex-frame-viewport') as HTMLDivElement;
      const canvas = parent.querySelector('.codex-frame-canvas') as HTMLCanvasElement;
      const width = 192 * scale;
      const height = 208 * scale;

      renderer.resize(width, height);

      expect(viewport.style.width).toBe(`${width}px`);
      expect(viewport.style.height).toBe(`${height}px`);
      expect(canvas.style.width).toBe(`${width}px`);
      expect(canvas.style.height).toBe(`${height}px`);
      expect(element.style.width).toBe(`${width}px`);
      expect(element.style.height).toBe(`${height}px`);
      expect(canvas.width).toBe(Math.round(width * window.devicePixelRatio));
      expect(canvas.height).toBe(Math.round(height * window.devicePixelRatio));

      renderer.destroy();
    }
  );

  it('plays a verified V2 row/column path and returns to the completion callback', () => {
    vi.useFakeTimers();
    const parent = document.createElement('div');
    parent.appendChild(element);
    const renderer = new CodexAtlasRenderer(
      element,
      'asset://localhost/spritesheet.webp',
      { ...adapterConfig, spriteVersionNumber: 2 },
    );
    const onComplete = vi.fn();

    expect(renderer.playFramePath({
      frames: [
        { row: 0, column: 4, durationMs: 300 },
        { row: 9, column: 2, durationMs: 400 },
        { row: 9, column: 4, durationMs: 800 },
      ],
      onComplete,
    })).toBe(true);
    expect((renderer as any).currentFramePath[0]).toMatchObject({ row: 0, column: 4 });
    vi.advanceTimersByTime(300);
    expect((renderer as any).currentFrameIndex).toBe(1);
    vi.advanceTimersByTime(1200);
    expect(onComplete).toHaveBeenCalledTimes(1);
    renderer.destroy();
    vi.useRealTimers();
  });

  it('plays V1 look-around frames from a validated extras atlas', () => {
    const parent = document.createElement('div');
    parent.appendChild(element);
    const extras = {
      schemaVersion: 1 as const,
      spritesheetPath: 'general-pets-extras.webp',
      frameWidth: 192,
      frameHeight: 208,
      animations: {
        lookAround: {
          row: 0,
          frameCount: 8,
          frameSequence: [0, 1, 0],
          frameDurationsMs: [600, 400, 600],
        },
      },
    };
    const renderer = new CodexAtlasRenderer(
      element,
      'asset://localhost/spritesheet.webp',
      adapterConfig,
      extras,
      'asset://localhost/general-pets-extras.webp',
    );
    expect(renderer.playFramePath({
      frames: [
        { row: 0, column: 0, source: 'extras', durationMs: 600 },
        { row: 0, column: 1, source: 'extras', durationMs: 400 },
      ],
    })).toBe(true);
    expect((renderer as any).currentFramePath[1]).toMatchObject({
      row: 0,
      column: 1,
      source: 'extras',
    });
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
