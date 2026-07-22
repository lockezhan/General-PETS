import { describe, expect, it, vi } from 'vitest';
import { CodexAtlasRenderer } from '../pet/render/codex-atlas-renderer';
import { FrameSequenceRenderer } from '../pet/render/frame-sequence-renderer';
import { CodexCharacterAdapter } from '../pet/codex/codex-character-adapter';

describe('renderer speed multiplier persistence', () => {
  it('keeps the configured multiplier for subsequent Codex actions', () => {
    const element = document.createElement('img');
    document.createElement('div').appendChild(element);
    const renderer = new CodexAtlasRenderer(
      element,
      'asset://localhost/spritesheet.webp',
      CodexCharacterAdapter.createDefaultConfig('speed-test')
    );
    const play = vi.spyOn((renderer as any).clock, 'play');

    renderer.updateSpeedMultiplier(0.5);
    renderer.play('waving');
    renderer.play('review');

    expect(play.mock.calls[0][3]).toBe(0.5);
    expect(play.mock.calls[1][3]).toBe(0.5);
    renderer.destroy();
  });

  it('keeps the configured multiplier for subsequent frame-sequence actions', () => {
    const loader = {
      load: vi.fn(),
      getConfig: vi.fn().mockReturnValue({
        animations: {
          waving: { path: 'waving', fps: 10, loop: false, frames: ['1', '2'] },
          review: { path: 'review', fps: 10, loop: false, frames: ['1', '2'] }
        }
      }),
      getFrames: vi.fn().mockImplementation((name: string) => [`/${name}/1.png`, `/${name}/2.png`])
    };
    const renderer = new FrameSequenceRenderer(loader as any, document.createElement('img'));
    const play = vi.spyOn((renderer as any).clock, 'play');

    renderer.updateSpeedMultiplier(0.5);
    renderer.play('waving');
    renderer.play('review');

    expect(play.mock.calls[0][3]).toBe(0.5);
    expect(play.mock.calls[1][3]).toBe(0.5);
    renderer.destroy();
  });

  it('normalizes legacy adapter locomotion defaults and clamps custom strides', () => {
    const defaults = CodexCharacterAdapter.normalizeCodexAdapterConfig({}, 'legacy');
    expect(defaults.locomotion).toEqual({
      walkStrideLengthPx: 72,
      dragStrideLengthPx: 72,
      runStrideLengthPx: 88
    });

    const custom = CodexCharacterAdapter.normalizeCodexAdapterConfig({
      locomotion: {
        walkStrideLengthPx: 10,
        dragStrideLengthPx: 84,
        runStrideLengthPx: 999
      }
    }, 'custom');
    expect(custom.locomotion).toEqual({
      walkStrideLengthPx: 32,
      dragStrideLengthPx: 84,
      runStrideLengthPx: 240
    });
  });
});
