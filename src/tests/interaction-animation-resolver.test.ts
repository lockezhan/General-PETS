import { describe, expect, it } from 'vitest';
import { resolveInteractionAnimation } from '../pet/interaction/resolve-interaction-animation';

describe('resolveInteractionAnimation', () => {
  it('prefers Codex standard interaction animations', () => {
    const available = new Set(['idle', 'waving', 'jumping', 'failed', 'review']);
    const hasAnimation = (name: string) => available.has(name);

    expect(resolveInteractionAnimation('singleClick', hasAnimation)).toBe('waving');
    expect(resolveInteractionAnimation('doubleClick', hasAnimation)).toBe('jumping');
    expect(resolveInteractionAnimation('rapidClick', hasAnimation)).toBe('failed');
    expect(resolveInteractionAnimation('longPress', hasAnimation)).toBe('review');
  });

  it('falls back to built-in character animations without requiring Codex rows', () => {
    const available = new Set(['idle', 'happy', 'angry', 'shy', 'surprised']);
    const hasAnimation = (name: string) => available.has(name);

    expect(resolveInteractionAnimation('singleClick', hasAnimation)).toBe('happy');
    expect(resolveInteractionAnimation('doubleClick', hasAnimation)).toBe('surprised');
    expect(resolveInteractionAnimation('rapidClick', hasAnimation)).toBe('angry');
    expect(resolveInteractionAnimation('longPress', hasAnimation)).toBe('shy');
  });
});
