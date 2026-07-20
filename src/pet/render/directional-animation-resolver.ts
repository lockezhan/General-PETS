import { CharacterSource } from '../codex/codex-types';

export type HorizontalDirection = "left" | "right";

export interface DirectionalAnimationResolution {
  animation: string;
  facing: HorizontalDirection;
  useFacingMirror: boolean;
}

export function resolveDirectionalAnimation(
  source: CharacterSource | null,
  direction: HorizontalDirection,
  hasAnimationFn: (name: string) => boolean
): DirectionalAnimationResolution {
  const isCodex = source && source.kind === 'installed';

  if (isCodex) {
    // Codex V1 and V2 return running-left and running-right and never mirror
    return {
      animation: direction === "left" ? "running-left" : "running-right",
      facing: direction,
      useFacingMirror: false
    };
  }

  // Situation A: supports both walkLeft and walkRight
  if (hasAnimationFn("walkLeft") && hasAnimationFn("walkRight")) {
    return {
      animation: direction === "left" ? "walkLeft" : "walkRight",
      facing: direction,
      useFacingMirror: false
    };
  }

  // Situation B: supports walk
  if (hasAnimationFn("walk")) {
    return {
      animation: "walk",
      facing: direction,
      useFacingMirror: direction === "left"
    };
  }

  // Situation C: lack walk animations
  return {
    animation: "idle",
    facing: direction,
    useFacingMirror: false
  };
}
