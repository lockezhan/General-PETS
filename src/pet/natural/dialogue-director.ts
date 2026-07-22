import { InteractionIntent } from './natural-types';
import { PetSettings } from '../../shared/pet-settings';

const PROBABILITIES: Record<InteractionIntent | "ambient", number> = {
  tap: 0.55,
  doubleTap: 0.70,
  rapidTap: 1.00,
  longPress: 0.80,
  stroke: 0.40,
  pickup: 0.00,
  ambient: 0.10,
  none: 0,
};

export function getDialogueDurationMs(text: string): number {
  const len = text.length;
  const ms = 1600 + len * 65;
  return Math.min(Math.max(ms, 1800), 4200);
}

export class DialogueDirector {
  private lastDialogueAt: number = Number.NEGATIVE_INFINITY;
  private strokeDialogueShown: boolean = false;

  public shouldShowDialogue(
    intent: InteractionIntent | "ambient",
    settings: PetSettings,
    now: number = performance.now(),
    forceInDev: boolean = false,
    baseProbabilityOverride?: number
  ): boolean {
    if (forceInDev && intent !== "pickup") return true;
    if (!settings.randomDialogueEnabled) return false;

    // 2500ms 冷却限制 (rapidTap 允许突破一次普通冷却)
    if (intent !== "rapidTap" && now - this.lastDialogueAt < 2500) {
      return false;
    }

    // 连续抚摸期间最多显示 1 次气泡
    if (intent === "stroke") {
      if (this.strokeDialogueShown) return false;
    }

    let baseProb = baseProbabilityOverride ?? PROBABILITIES[intent] ?? 0.15;
    if (settings.dialogueFrequency === "quiet") baseProb *= 0.5;
    if (settings.dialogueFrequency === "frequent") baseProb = Math.min(1, baseProb * 1.25);

    const roll = Math.random();
    const result = roll < baseProb;

    if (result && intent === "stroke") {
      this.strokeDialogueShown = true;
    }

    return result;
  }

  public recordDialogueShown(now: number = performance.now()) {
    this.lastDialogueAt = now;
  }

  public resetStrokeDialogueState() {
    this.strokeDialogueShown = false;
  }
}
