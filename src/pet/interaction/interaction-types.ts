export type InteractionEventType =
  | "singleClick"
  | "doubleClick"
  | "rapidClick"
  | "longPress"
  | "dragStart"
  | "dragEnd";

export interface HitAreaBase {
  id: string;
  name?: string;
  priority?: number;
  draggable?: boolean;
}

export interface RectHitArea extends HitAreaBase {
  shape: "rect";
  x: number; // 0-1
  y: number; // 0-1
  width: number; // 0-1
  height: number; // 0-1
}

export interface EllipseHitArea extends HitAreaBase {
  shape: "ellipse";
  cx: number; // 0-1
  cy: number; // 0-1
  rx: number; // 0-1
  ry: number; // 0-1
}

export interface PolygonHitArea extends HitAreaBase {
  shape: "polygon";
  points: Array<[number, number]>; // each point is [x, y] in 0-1
}

export type HitAreaShape =
  | RectHitArea
  | EllipseHitArea
  | PolygonHitArea;

export type InteractionAction =
  | {
      type: "playAnimation";
      animation: string;
      fallback?: string;
    }
  | {
      type: "showDialogue";
      group: string;
    }
  | {
      type: "resetBehaviorTimer";
    }
  | {
      type: "cancelMotion";
    }
  | {
      type: "setFacing";
      facing: "left" | "right";
    };

export interface InteractionRule {
  id: string;
  event: InteractionEventType;
  area: string | "*";
  states?: string[];
  priority?: number; // default 0
  weight?: number; // default 100
  cooldownMs?: number; // default 0
  exclusive?: boolean; // default true
  actions: InteractionAction[];
}

export interface InteractionManifest {
  schemaVersion: 1;
  hitAreas: HitAreaShape[];
  rules: InteractionRule[];
  fallbackRules?: Partial<
    Record<
      InteractionEventType,
      {
        animation?: string;
        dialogueGroup?: string;
      }
    >
  >;
}

export interface PointerSession {
  startScreenX: number;
  startScreenY: number;
  startClientX: number;
  startClientY: number;
  areaId: string | null;
  draggable: boolean;
  startedAt: number;
  dragging: boolean;
  nativeDragRequested: boolean;
  longPressTriggered: boolean;
  cancelled: boolean;
}
