export type VerticalDragAnimation = 'jumping' | 'waiting';

export const VERTICAL_JUMP_ENTER_SPEED = 140;
export const VERTICAL_JUMP_EXIT_SPEED = 70;

/**
 * Keeps slow vertical drags visually stable. Entering the airborne pose needs
 * a deliberate fast movement, while an existing airborne pose is retained
 * through the noisy middle band until the pointer has clearly slowed down.
 */
export function resolveVerticalDragAnimation(
  currentAnimation: string | null,
  velocityY: number,
): VerticalDragAnimation {
  const speed = Math.abs(velocityY);
  if (currentAnimation === 'jumping') {
    return speed > VERTICAL_JUMP_EXIT_SPEED ? 'jumping' : 'waiting';
  }
  return speed >= VERTICAL_JUMP_ENTER_SPEED ? 'jumping' : 'waiting';
}
