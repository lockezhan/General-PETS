import { describe, expect, it } from 'vitest';
import {
  resolveVerticalDragAnimation,
  VERTICAL_JUMP_ENTER_SPEED,
  VERTICAL_JUMP_EXIT_SPEED,
} from '../pet/drag-animation-policy';

describe('vertical drag animation policy', () => {
  it('keeps slow vertical movement in one stable waiting pose', () => {
    const noisySlowSamples = [0, 62, 28, 79, 45, 68];

    expect(noisySlowSamples.map((velocity) =>
      resolveVerticalDragAnimation('waiting', velocity)
    )).toEqual(noisySlowSamples.map(() => 'waiting'));
  });

  it('uses hysteresis around the airborne pose', () => {
    expect(resolveVerticalDragAnimation('waiting', VERTICAL_JUMP_ENTER_SPEED - 1)).toBe('waiting');
    expect(resolveVerticalDragAnimation('waiting', VERTICAL_JUMP_ENTER_SPEED)).toBe('jumping');
    expect(resolveVerticalDragAnimation('jumping', VERTICAL_JUMP_EXIT_SPEED + 1)).toBe('jumping');
    expect(resolveVerticalDragAnimation('jumping', VERTICAL_JUMP_EXIT_SPEED)).toBe('waiting');
  });

  it('treats upward and downward speed symmetrically', () => {
    expect(resolveVerticalDragAnimation('waiting', VERTICAL_JUMP_ENTER_SPEED)).toBe('jumping');
    expect(resolveVerticalDragAnimation('waiting', -VERTICAL_JUMP_ENTER_SPEED)).toBe('jumping');
  });
});
