import { getCurrentWindow } from '@tauri-apps/api/window';
import { InteractionEventType, PointerSession, GesturePhase } from './interaction-types';
import { StrokeRecognizer } from '../natural/stroke-recognizer';
import { NaturalPointerSession, InteractionRole } from '../natural/natural-types';

const DRAG_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 800;
const DOUBLE_CLICK_WINDOW_MS = 280;
const RAPID_CLICK_WINDOW_MS = 2000;
const RAPID_CLICK_THRESHOLD = 5;

export interface RecognizerCallbacks {
  onEvent: (event: InteractionEventType, areaId: string | null, clientX: number, clientY: number) => void;
  onDragStart: (areaId: string | null, initialDirection: "left" | "right" | null) => void;
  onDragEnd: (areaId: string | null) => void;
  findArea: (clientX: number, clientY: number) => { 
    id: string; 
    draggable?: boolean;
    interactionRole?: InteractionRole;
    acceptsStroke?: boolean;
  } | null;
  isInteractionEnabled: () => boolean;
  isDragEnabled: () => boolean;
  onPressStart?: () => void;
  onPressCancel?: () => void;
}

export class InteractionRecognizer {
  private element: HTMLElement;
  private callbacks: RecognizerCallbacks;
  private session: PointerSession | null = null;
  private naturalSession: NaturalPointerSession | null = null;
  private strokeRecognizer: StrokeRecognizer;
  private clickQueue: Array<{ timestamp: number; areaId: string | null }> = [];
  private singleClickTimer: number | null = null;
  private longPressTimer: number | null = null;

  constructor(element: HTMLElement, callbacks: RecognizerCallbacks) {
    this.element = element;
    this.callbacks = callbacks;
    this.strokeRecognizer = new StrokeRecognizer();
    this.bindEvents();
  }

  private bindEvents() {
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
  }

  public unbindEvents() {
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('pointercancel', this.handlePointerCancel);
    this.clearTimers();
  }

  public clearTimers() {
    this.clearLongPressTimer();
    this.clearSingleClickTimer();
  }

  private clearLongPressTimer() {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private clearSingleClickTimer() {
    if (this.singleClickTimer !== null) {
      clearTimeout(this.singleClickTimer);
      this.singleClickTimer = null;
    }
  }

  private finishDrag(reason: string) {
    if (!this.session || !this.session.dragging) {
      return;
    }
    console.log(`[gesture] finishDrag reason=${reason}`);
    this.session.dragging = false;
    const areaId = this.session.areaId;
    this.callbacks.onDragEnd(areaId);
  }

  private handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;

    const area = this.callbacks.findArea(e.clientX, e.clientY);
    if (!area) return;

    const interactionOk = this.callbacks.isInteractionEnabled();
    const dragOk = this.callbacks.isDragEnabled();
    if (!interactionOk && !dragOk) return;

    // 区域角色定位：只有 pickup 或显示包含 draggable 的区域才支持拖动
    const role: InteractionRole = area.interactionRole || (area.draggable ? "pickup" : "touch");
    const isDraggable = (role === "pickup" || role === "touch-and-pickup") && area.draggable !== false && dragOk;

    console.log(`[gesture] pointerdown area=${area.id} role=${role} draggable=${isDraggable}`);

    try {
      this.element.setPointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }

    const now = performance.now();

    this.naturalSession = {
      pointerId: e.pointerId,
      areaId: area.id,
      interactionRole: role,
      acceptsStroke: area.acceptsStroke !== false,
      draggable: isDraggable,
      startedAt: now,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      totalPathLength: 0,
      directDistance: 0,
      directionReversals: 0,
      lastAngle: null,
      averageSpeed: 0,
      maxSpeed: 0,
      strokeCommitted: false,
      pickupCommitted: false,
      longPressEligible: false,
      longPressCommitted: false,
      cancelled: false
    };

    this.session = {
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pointerId: e.pointerId,
      areaId: area.id,
      draggable: isDraggable,
      startedAt: now,
      maxDistance: 0,
      phase: 'pending' as GesturePhase,
      longPressEligible: false,
      dragging: false,
      nativeDragRequested: false,
      longPressTriggered: false,
      cancelled: false,
    };

    this.clearLongPressTimer();
    if (interactionOk) {
      const capturedClientX = e.clientX;
      const capturedClientY = e.clientY;
      this.longPressTimer = window.setTimeout(() => {
        if (
          this.session &&
          this.session.phase === 'pending' &&
          !this.session.cancelled &&
          (!this.naturalSession || !this.naturalSession.strokeCommitted)
        ) {
          console.log(`[gesture] longPressEligible set`);
          this.session.longPressEligible = true;
          this.session.phase = 'longPressEligible';
          (this.session as any)._longPressClientX = capturedClientX;
          (this.session as any)._longPressClientY = capturedClientY;
        }
      }, LONG_PRESS_MS);
    }
    this.callbacks.onPressStart?.();
  };

  private handlePointerMove = async (e: PointerEvent) => {
    if (!this.session || this.session.phase === 'cancelled' || this.session.phase === 'dragging') return;

    const deltaX = e.screenX - this.session.startScreenX;
    const deltaY = e.screenY - this.session.startScreenY;
    const distance = Math.hypot(deltaX, deltaY);

    if (distance > this.session.maxDistance) {
      this.session.maxDistance = distance;
    }

    const now = performance.now();

    // 1. 抚摸分析
    if (this.naturalSession) {
      this.strokeRecognizer.updateMove(this.naturalSession, e.clientX, e.clientY, now);

      if (this.naturalSession.strokeCommitted && !this.session.nativeDragRequested) {
        this.clearLongPressTimer();
        this.clearSingleClickTimer();
        this.callbacks.onEvent("stroke", this.session.areaId, e.clientX, e.clientY);
      }
    }

    // 2. 拖拽提起判定（严格限制：只有可拖拽区域才触发原生拖动）
    if (distance >= DRAG_THRESHOLD_PX) {
      this.clearLongPressTimer();
      this.clearSingleClickTimer();

      if (this.session.draggable) {
        if (this.naturalSession) this.naturalSession.pickupCommitted = true;

        if (!this.session.nativeDragRequested) {
          this.session.phase = 'dragging';
          this.session.longPressEligible = false;
          this.session.dragging = true;
          this.session.nativeDragRequested = true;

          let initialDirection: "left" | "right" | null = null;
          if (Math.abs(deltaX) >= Math.abs(deltaY) && Math.abs(deltaX) >= DRAG_THRESHOLD_PX) {
            initialDirection = deltaX < 0 ? "left" : "right";
          }

          console.log(`[gesture] native-drag-start initialDirection=${initialDirection ?? 'vertical'}`);
          this.callbacks.onPressCancel?.();
          this.callbacks.onDragStart(this.session.areaId, initialDirection);

          try {
            this.element.releasePointerCapture(this.session.pointerId);
          } catch (_) { /* ignore */ }

          const dragStartedAt = performance.now();
          try {
            await getCurrentWindow().startDragging();
          } catch (error) {
            console.error("[gesture] startDragging failed:", error);
          } finally {
            const elapsed = (performance.now() - dragStartedAt).toFixed(0);
            console.log(`[native-drag] resolved elapsed=${elapsed}ms`);
            this.finishDrag("native drag resolved");
          }
        }
      } else if (this.session.phase === 'pending' || this.session.phase === 'longPressEligible') {
        if (!this.naturalSession?.strokeCommitted) {
          this.session.phase = 'cancelled';
          this.session.cancelled = true;
          this.clearTimers();
          this.callbacks.onPressCancel?.();
        }
      }
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }

    if (!this.session) return;

    console.log(`[gesture] pointerup phase=${this.session.phase} maxDistance=${this.session.maxDistance.toFixed(1)}px`);

    this.clearLongPressTimer();
    this.callbacks.onPressCancel?.();

    const phase = this.session.phase;

    if (phase === 'dragging' || this.session.nativeDragRequested) {
      this.finishDrag("pointerup");
      this.session = null;
      this.naturalSession = null;
      return;
    }

    if (this.naturalSession?.strokeCommitted) {
      console.log(`[gesture] stroke finished on pointerup`);
      this.session = null;
      this.naturalSession = null;
      return;
    }

    if (phase === 'cancelled') {
      this.session = null;
      this.naturalSession = null;
      return;
    }

    if (phase === 'longPressEligible') {
      const lx = (this.session as any)._longPressClientX ?? e.clientX;
      const ly = (this.session as any)._longPressClientY ?? e.clientY;
      console.log(`[gesture] longPress committed on pointerup`);
      this.session.longPressTriggered = true;
      this.session.phase = 'longPressCommitted';
      this.callbacks.onEvent("longPress", this.session.areaId, lx, ly);
      this.session = null;
      this.naturalSession = null;
      return;
    }

    if (!this.callbacks.isInteractionEnabled()) {
      this.session = null;
      this.naturalSession = null;
      return;
    }

    const now = performance.now();
    const areaId = this.session.areaId;

    this.clickQueue.push({ timestamp: now, areaId });
    this.clickQueue = this.clickQueue.filter(
      c => c.areaId === areaId && now - c.timestamp <= RAPID_CLICK_WINDOW_MS
    );

    if (this.clickQueue.length >= RAPID_CLICK_THRESHOLD) {
      this.clearSingleClickTimer();
      this.clickQueue = [];
      this.callbacks.onEvent("rapidClick", areaId, e.clientX, e.clientY);
    } else {
      if (this.singleClickTimer !== null) {
        this.clearSingleClickTimer();
        this.callbacks.onEvent("doubleClick", areaId, e.clientX, e.clientY);
      } else {
        const clientX = e.clientX;
        const clientY = e.clientY;
        this.singleClickTimer = window.setTimeout(() => {
          this.singleClickTimer = null;
          this.callbacks.onEvent("singleClick", areaId, clientX, clientY);
        }, DOUBLE_CLICK_WINDOW_MS);
      }
    }

    this.session = null;
    this.naturalSession = null;
  };

  private handlePointerCancel = (e: PointerEvent) => {
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }

    if (this.session) {
      if (this.session.phase === 'dragging' || this.session.nativeDragRequested) {
        this.finishDrag("pointercancel");
      }
      this.session.phase = 'cancelled';
      this.session.cancelled = true;
    }
    this.clearTimers();
    this.callbacks.onPressCancel?.();
    this.session = null;
    this.naturalSession = null;
  };
}
