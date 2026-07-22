import { describe, expect, it } from 'vitest';
import { CodexCharacterAdapter } from '../pet/codex/codex-character-adapter';
import { resolveCharacterCapabilities } from '../pet/codex/character-capabilities';

const verifiedDirections = {
  center: { row: 0, column: 0 },
  up: { row: 9, column: 0 },
  upperRight: { row: 9, column: 2 },
  right: { row: 9, column: 4 },
  lowerRight: { row: 9, column: 6 },
  down: { row: 10, column: 0 },
  lowerLeft: { row: 10, column: 2 },
  left: { row: 10, column: 4 },
  upperLeft: { row: 10, column: 6 },
};

describe('character look-around capabilities', () => {
  it('does not enable a V1 character without extras', () => {
    const adapter = CodexCharacterAdapter.createDefaultConfig('v1');
    expect(resolveCharacterCapabilities(adapter, null)).toEqual({
      supportsLookAround: false,
      lookAroundSource: null,
    });
  });

  it('enables a V1 character only with validated extras', () => {
    const adapter = CodexCharacterAdapter.createDefaultConfig('v1-extras');
    const extras = CodexCharacterAdapter.normalizeExtrasConfig({
      schemaVersion: 1,
      spritesheetPath: 'general-pets-extras.webp',
      frameWidth: 192,
      frameHeight: 208,
      animations: {
        lookAround: {
          row: 0,
          frameCount: 8,
          frameSequence: [0, 1, 2, 1, 0, 7, 6, 7, 0],
          frameDurationsMs: [600, 350, 800, 350, 700, 350, 800, 350, 900],
        },
      },
    });
    expect(resolveCharacterCapabilities(adapter, extras)).toEqual({
      supportsLookAround: true,
      lookAroundSource: 'general-pets-extras',
    });
  });

  it('does not enable V2 from the version number alone', () => {
    const adapter = { ...CodexCharacterAdapter.createDefaultConfig('unmapped-v2'), spriteVersionNumber: 2 as const };
    expect(resolveCharacterCapabilities(adapter, null).supportsLookAround).toBe(false);
  });

  it('enables V2 after every required direction has a validated mapping', () => {
    const adapter = CodexCharacterAdapter.normalizeCodexAdapterConfig({
      ...CodexCharacterAdapter.createDefaultConfig('mapped-v2'),
      spriteVersionNumber: 2,
      lookDirections: verifiedDirections,
    }, 'mapped-v2');
    expect(resolveCharacterCapabilities(adapter, null)).toEqual({
      supportsLookAround: true,
      lookAroundSource: 'codex-v2',
    });
  });

  it('drops invalid idle sequences instead of masking an out-of-range frame', () => {
    const adapter = CodexCharacterAdapter.normalizeCodexAdapterConfig({
      ...CodexCharacterAdapter.createDefaultConfig('bad-sequence'),
      animationSequences: { idle: [0, 6] },
    }, 'bad-sequence');
    expect(adapter.animationSequences?.idle).toBeUndefined();
  });
});
