import { AnimationTiming } from '../../shared/character-types';

export const CODEX_ATLAS_CONTRACTS = {
  1: {
    version: 1,
    columns: 8,
    rows: 9,
    frameWidth: 192,
    frameHeight: 208,
    atlasWidth: 1536,
    atlasHeight: 1872,
    supportsLookDirections: false,
  },
  2: {
    version: 2,
    columns: 8,
    rows: 11,
    frameWidth: 192,
    frameHeight: 208,
    atlasWidth: 1536,
    atlasHeight: 2288,
    supportsLookDirections: true,
    lookDirectionStartRow: 9,
    lookDirectionFrameCount: 16,
  },
} as const;

export type CodexV1AnimationName =
  | "idle"
  | "running-right"
  | "running-left"
  | "waving"
  | "jumping"
  | "failed"
  | "waiting"
  | "running"
  | "review";

export const CODEX_BASE_ANIMATIONS = {
  idle: {
    row: 0,
    frameCount: 6,
  },
  "running-right": {
    row: 1,
    frameCount: 8,
  },
  "running-left": {
    row: 2,
    frameCount: 8,
  },
  waving: {
    row: 3,
    frameCount: 4,
  },
  jumping: {
    row: 4,
    frameCount: 5,
  },
  failed: {
    row: 5,
    frameCount: 8,
  },
  waiting: {
    row: 6,
    frameCount: 6,
  },
  running: {
    row: 7,
    frameCount: 6,
  },
  review: {
    row: 8,
    frameCount: 6,
  },
} as const;

export const CODEX_DEFAULT_TIMINGS: Record<CodexV1AnimationName, AnimationTiming> = {
  idle: {
    frameDurationMs: 160,
    lastFrameDurationMs: 360,
    loop: true,
    holdFrameIndex: 0,
    loopDelayRangeMs: {
      min: 2200,
      max: 5200,
    },
  },
  "running-right": {
    frameDurationMs: 120,
    lastFrameDurationMs: 180,
    loop: true,
  },
  "running-left": {
    frameDurationMs: 120,
    lastFrameDurationMs: 180,
    loop: true,
  },
  waving: {
    frameDurationMs: 140,
    lastFrameDurationMs: 300,
    loop: false,
  },
  jumping: {
    frameDurationMs: 130,
    lastFrameDurationMs: 280,
    loop: false,
  },
  failed: {
    frameDurationMs: 140,
    lastFrameDurationMs: 400,
    loop: false,
  },
  waiting: {
    frameDurationMs: 220,
    lastFrameDurationMs: 360,
    loop: true,
    holdFrameIndex: 0,
    loopDelayRangeMs: {
      min: 600,
      max: 1600,
    },
  },
  running: {
    frameDurationMs: 120,
    lastFrameDurationMs: 200,
    loop: true,
  },
  review: {
    frameDurationMs: 160,
    lastFrameDurationMs: 360,
    loop: false,
  },
} as const;
