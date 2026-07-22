import type { CodexAdapterConfig } from './codex-types';

/**
 * Character-specific mappings are admitted only after contact-sheet QA.
 * spriteVersionNumber alone is deliberately insufficient.
 */
const VERIFIED_OVERRIDES: Record<string, Partial<CodexAdapterConfig>> = {
  'xiaoqian-chibi-v2': {
    animationSequences: {
      // Column 2 is a unilateral wink. Column 3 is the verified simultaneous blink.
      idle: [0, 1, 0, 4, 3, 4, 0, 5],
    },
    lookDirections: {
      center: { row: 0, column: 4 },
      up: { row: 9, column: 0 },
      upperRight: { row: 9, column: 2 },
      right: { row: 9, column: 4 },
      lowerRight: { row: 9, column: 6 },
      down: { row: 10, column: 0 },
      lowerLeft: { row: 10, column: 2 },
      left: { row: 10, column: 4 },
      upperLeft: { row: 10, column: 6 },
    },
  },
};

export function applyVerifiedAdapterOverride(raw: unknown, sourcePetId: string): unknown {
  const override = VERIFIED_OVERRIDES[sourcePetId];
  if (!override) return raw;
  const base = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    ...base,
    ...override,
    animationSequences: {
      ...(base.animationSequences as Record<string, unknown> | undefined),
      ...override.animationSequences,
    },
  };
}
