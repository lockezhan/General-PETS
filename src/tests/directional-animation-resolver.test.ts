import { describe, it, expect } from 'vitest';
import { resolveDirectionalAnimation } from '../pet/render/directional-animation-resolver';
import { CharacterSource } from '../pet/codex/codex-types';

describe('Directional Animation Resolver', () => {
  it('should resolve running-left and running-right for Codex custom characters without mirroring', () => {
    const source: CharacterSource = {
      kind: 'installed',
      id: 'codex-custom',
      rootPath: '/path/to/character'
    };

    const leftRes = resolveDirectionalAnimation(source, 'left', () => true);
    expect(leftRes.animation).toBe('walkLeft');
    expect(leftRes.facing).toBe('left');
    expect(leftRes.useFacingMirror).toBe(false);

    const rightRes = resolveDirectionalAnimation(source, 'right', () => true);
    expect(rightRes.animation).toBe('walkRight');
    expect(rightRes.facing).toBe('right');
    expect(rightRes.useFacingMirror).toBe(false);
  });

  it('should resolve walkLeft/walkRight if both walkLeft and walkRight animations exist', () => {
    const animMap = new Set(['walkLeft', 'walkRight']);
    const hasAnim = (name: string) => animMap.has(name);

    const leftRes = resolveDirectionalAnimation(null, 'left', hasAnim);
    expect(leftRes.animation).toBe('walkLeft');
    expect(leftRes.facing).toBe('left');
    expect(leftRes.useFacingMirror).toBe(false);

    const rightRes = resolveDirectionalAnimation(null, 'right', hasAnim);
    expect(rightRes.animation).toBe('walkRight');
    expect(rightRes.facing).toBe('right');
    expect(rightRes.useFacingMirror).toBe(false);
  });

  it('should resolve walk and mirror appropriately if only walk animation exists', () => {
    const animMap = new Set(['walk']);
    const hasAnim = (name: string) => animMap.has(name);

    const leftRes = resolveDirectionalAnimation(null, 'left', hasAnim);
    expect(leftRes.animation).toBe('walk');
    expect(leftRes.facing).toBe('left');
    expect(leftRes.useFacingMirror).toBe(true);

    const rightRes = resolveDirectionalAnimation(null, 'right', hasAnim);
    expect(rightRes.animation).toBe('walk');
    expect(rightRes.facing).toBe('right');
    expect(rightRes.useFacingMirror).toBe(false);
  });

  it('should fallback to idle if no walking animations are supported', () => {
    const hasAnim = () => false;

    const leftRes = resolveDirectionalAnimation(null, 'left', hasAnim);
    expect(leftRes.animation).toBe('idle');
    expect(leftRes.facing).toBe('left');
    expect(leftRes.useFacingMirror).toBe(false);
  });
});
