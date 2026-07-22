export type InteractionAnimationIntent =
  | "singleClick"
  | "doubleClick"
  | "rapidClick"
  | "longPress";

const INTERACTION_ANIMATION_CANDIDATES: Record<
  InteractionAnimationIntent,
  readonly string[]
> = {
  singleClick: ["waving", "happy"],
  doubleClick: ["jumping", "surprised", "happy"],
  rapidClick: ["failed", "angry"],
  longPress: ["review", "shy", "happy"]
};

export function resolveInteractionAnimation(
  intent: InteractionAnimationIntent,
  hasAnimation: (name: string) => boolean
): string {
  return INTERACTION_ANIMATION_CANDIDATES[intent].find(hasAnimation) ?? "idle";
}
