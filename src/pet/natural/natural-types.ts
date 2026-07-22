import { AnimationTiming } from '../../shared/character-types';

export type InteractionStyle = "codex-simple" | "advanced-petting";

export type InteractionIntent =
  | "tap"
  | "doubleTap"
  | "rapidTap"
  | "longPress"
  | "stroke"
  | "pickup"
  | "none";

export type InteractionRole =
  | "touch"
  | "pickup"
  | "touch-and-pickup";

export interface HitAreaBase {
  id: string;
  name?: string;
  shape: "rect" | "ellipse" | "polygon";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  points?: [number, number][];
  priority?: number;
  interactionRole?: InteractionRole;
  acceptsStroke?: boolean;
  draggable?: boolean;
}

export interface NaturalPointerSession {
  pointerId: number;
  areaId: string;
  interactionRole: InteractionRole;
  acceptsStroke: boolean;
  draggable: boolean;
  startedAt: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  totalPathLength: number;
  directDistance: number;
  directionReversals: number;
  lastAngle: number | null;
  averageSpeed: number;
  maxSpeed: number;
  strokeCommitted: boolean;
  pickupCommitted: boolean;
  longPressEligible: boolean;
  longPressCommitted: boolean;
  cancelled: boolean;
}

export type ActionPriority =
  | "ambient"
  | "interaction"
  | "locomotion"
  | "system";

export interface PetActionRequest {
  id: string;
  animation: string;
  priority: ActionPriority;
  interruptPolicy?: "immediate" | "safe-frame" | "after-current" | "extend-same";
  fallback?: string;
  minimumVisibleMs?: number;
  holdAfterMs?: number;
  source: "user" | "behavior" | "system";
  timingOverride?: Partial<AnimationTiming>;
  loop?: boolean;
  onComplete?: () => void;
}

export interface BehaviorContext {
  idleDurationMs: number;
  sinceLastUserInteractionMs: number;
  lastActionId: string | null;
  recentActions: string[];
  facing: "left" | "right";
  nearLeftEdge: boolean;
  nearRightEdge: boolean;
  currentHour: number;
}

export type DragPose =
  | "pressing"
  | "pickup-start"
  | "carried-static"
  | "carried-left"
  | "carried-right"
  | "carried-vertical"
  | "release";

export const DEFAULT_CODEX_HIT_AREAS: HitAreaBase[] = [
  {
    id: "head",
    name: "头部",
    shape: "ellipse",
    cx: 0.5,
    cy: 0.23,
    rx: 0.28,
    ry: 0.20,
    priority: 40,
    interactionRole: "touch-and-pickup",
    acceptsStroke: true,
    draggable: true
  },
  {
    id: "face",
    name: "脸部",
    shape: "ellipse",
    cx: 0.5,
    cy: 0.32,
    rx: 0.18,
    ry: 0.13,
    priority: 50,
    interactionRole: "touch-and-pickup",
    acceptsStroke: false,
    draggable: true
  },
  {
    id: "body",
    name: "身体",
    shape: "rect",
    x: 0.24,
    y: 0.38,
    width: 0.52,
    height: 0.52,
    priority: 20,
    interactionRole: "touch-and-pickup",
    acceptsStroke: true,
    draggable: true
  },
  {
    id: "whole-pet",
    name: "完整角色",
    shape: "rect",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    priority: 0,
    interactionRole: "touch-and-pickup",
    acceptsStroke: false,
    draggable: true
  }
];
