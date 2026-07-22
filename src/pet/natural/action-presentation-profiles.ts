export interface ActionPresentationProfile {
  repeatCount?: number;
  minimumVisibleMs?: number;
  holdAfterMs?: number;
  loop?: boolean;
  durationRangeMs?: {
    min: number;
    max: number;
  };
}

export const CODEX_ACTION_PRESENTATION: Record<string, ActionPresentationProfile> = {
  waving: {
    repeatCount: 2,
    minimumVisibleMs: 1600,
    holdAfterMs: 180
  },
  jumping: {
    repeatCount: 2,
    minimumVisibleMs: 1800,
    holdAfterMs: 220
  },
  failed: {
    repeatCount: 1,
    minimumVisibleMs: 1500,
    holdAfterMs: 450
  },
  review: {
    repeatCount: 1,
    minimumVisibleMs: 1700,
    holdAfterMs: 500
  },
  waiting: {
    loop: true,
    durationRangeMs: { min: 3500, max: 6500 }
  },
  running: {
    loop: true,
    durationRangeMs: { min: 1800, max: 3000 }
  }
};

export function getInteractionPresentation(animation: string): ActionPresentationProfile {
  const canonical = ({
    happy: 'waving',
    surprised: 'jumping',
    angry: 'failed',
    shy: 'review'
  } as Record<string, string>)[animation] ?? animation;
  return { ...(CODEX_ACTION_PRESENTATION[canonical] ?? {}) };
}

export function getAmbientPresentation(animation: string): ActionPresentationProfile {
  const canonical = ({ happy: 'waving', surprised: 'jumping', shy: 'review' } as Record<string, string>)[animation] ?? animation;
  if (canonical === 'waving') {
    return {
      repeatCount: 1,
      minimumVisibleMs: 2200,
      holdAfterMs: 350,
    };
  }
  if (canonical === 'review') {
    return {
      repeatCount: 1,
      minimumVisibleMs: 2600,
      holdAfterMs: 550
    };
  }
  if (canonical === 'jumping') {
    return { repeatCount: 1, minimumVisibleMs: 2000, holdAfterMs: 400 };
  }
  if (canonical === 'waiting') return { loop: true, durationRangeMs: { min: 4500, max: 8000 } };
  if (canonical === 'running') return { loop: true, durationRangeMs: { min: 2600, max: 4200 } };
  return { ...(CODEX_ACTION_PRESENTATION[canonical] ?? {}) };
}

export function randomDuration(range: { min: number; max: number }): number {
  const min = Math.max(0, Math.min(range.min, range.max));
  const max = Math.max(min, range.max);
  return min + Math.random() * (max - min);
}

export function getAmbientDialogueProbability(
  frequency: 'quiet' | 'normal' | 'frequent',
  logicalAction: string
): number {
  const base = frequency === 'quiet' ? 0.12 : frequency === 'frequent' ? 0.45 : 0.30;
  return logicalAction === 'hop' ? base * 0.4 : base;
}
