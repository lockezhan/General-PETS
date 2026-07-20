import { getCurrentWindow } from '@tauri-apps/api/window';
import { InteractionEventType, PointerSession } from './interaction-types';

const DRAG_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 800;
const DOUBLE_CLICK_WINDOW_MS = 280;
const RAPID_CLICK_WINDOW_MS = 2000;
const RAPID_CLICK_THRESHOLD = 5;

export interface RecognizerCallbacks {
  onEvent: (event: InteractionEventType, areaId: string | null, clientX: number, clientY: number) => void;
  onDragStart: (areaId: string | null) => void;
  onDragEnd: (areaId: string | null) => void;
  findArea: (clientX: number, clientY: number) => { id: string; draggable?: boolean } | null;
  isEnabled: () => boolean;
}

export class InteractionRecognizer {
  private element: HTMLElement;
  private callbacks: RecognizerCallbacks;
  private session: PointerSession | null = null;
  private clickQueue: Array<{ timestamp: number; areaId: string | null }> = [];
  private singleClickTimer: number | null = null;
  private longPressTimer: number | null = null;

  constructor(element: HTMLElement, callbacks: RecognizerCallbacks) {
    this.element = element;
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents() {
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    // Bind pointermove and pointerup to window to track movement outside element
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

  private handlePointerDown = (e: PointerEvent) => {
    if (!this.callbacks.isEnabled()) return;
    if (e.button !== 0) return; // Only left click

    const area = this.callbacks.findArea(e.clientX, e.clientY);
    if (!area) {
      // "未命中时不创建互动会话"
      return;
    }

    // Set pointer capture to ensure we receive moves/ups even if cursor leaves window
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch (err) {
      // setPointerCapture might fail in some contexts, safe ignore
    }

    this.session = {
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      areaId: area.id,
      draggable: area.draggable !== false, // default true
      startedAt: performance.now(),
      dragging: false,
      nativeDragRequested: false,
      longPressTriggered: false,
      cancelled: false
    };

    this.clearLongPressTimer();
    this.longPressTimer = window.setTimeout(() => {
      if (this.session && !this.session.dragging && !this.session.cancelled) {
        this.session.longPressTriggered = true;
        this.callbacks.onEvent("longPress", this.session.areaId, e.clientX, e.clientY);
      }
    }, LONG_PRESS_MS);
  };

  private handlePointerMove = async (e: PointerEvent) => {
    if (!this.session || this.session.cancelled) return;

    const distance = Math.hypot(
      e.screenX - this.session.startScreenX,
      e.screenY - this.session.startScreenY
    );

    if (distance >= DRAG_THRESHOLD_PX) {
      this.clearLongPressTimer();
      this.clearSingleClickTimer();

      if (this.session.draggable) {
        if (!this.session.dragging && !this.session.nativeDragRequested) {
          this.session.dragging = true;
          this.session.nativeDragRequested = true;
          
          this.callbacks.onDragStart(this.session.areaId);

          try {
            await getCurrentWindow().startDragging();
          } catch (error) {
            console.error("[drag] native drag failed:", error);
          } finally {
            if (this.session) {
              this.session.dragging = false;
            }
            this.callbacks.onDragEnd(this.session ? this.session.areaId : null);
          }
        }
      } else {
        // "draggable=false 时取消本次会话"
        this.session.cancelled = true;
        this.clearTimers();
      }
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    // Release pointer capture
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch (err) {
      // safe ignore
    }

    if (!this.session) return;

    this.clearLongPressTimer();

    if (this.session.cancelled || this.session.dragging || this.session.nativeDragRequested || this.session.longPressTriggered) {
      // Drag/longPress already handled or cancelled
      this.session = null;
      return;
    }

    const now = performance.now();
    const areaId = this.session.areaId;

    // Filter queue to check for rapid clicks
    this.clickQueue.push({ timestamp: now, areaId });
    this.clickQueue = this.clickQueue.filter(
      c => c.areaId === areaId && now - c.timestamp <= RAPID_CLICK_WINDOW_MS
    );

    if (this.clickQueue.length >= RAPID_CLICK_THRESHOLD) {
      // Trigger rapidClick
      this.clearSingleClickTimer();
      this.clickQueue = []; // Reset queue for this area
      this.callbacks.onEvent("rapidClick", areaId, e.clientX, e.clientY);
    } else {
      // Single/double click logic
      if (this.singleClickTimer !== null) {
        // Second click in window
        this.clearSingleClickTimer();
        this.callbacks.onEvent("doubleClick", areaId, e.clientX, e.clientY);
      } else {
        // First click, wait for second
        const clientX = e.clientX;
        const clientY = e.clientY;
        this.singleClickTimer = window.setTimeout(() => {
          this.singleClickTimer = null;
          this.callbacks.onEvent("singleClick", areaId, clientX, clientY);
        }, DOUBLE_CLICK_WINDOW_MS);
      }
    }

    this.session = null;
  };

  private handlePointerCancel = (e: PointerEvent) => {
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch (err) {
      // safe ignore
    }

    if (this.session) {
      this.session.cancelled = true;
    }
    this.clearTimers();
    this.session = null;
  };
}
