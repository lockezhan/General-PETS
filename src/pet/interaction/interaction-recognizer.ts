import { getCurrentWindow } from '@tauri-apps/api/window';
import { InteractionEventType, PointerSession, GesturePhase } from './interaction-types';

const DRAG_THRESHOLD_PX = 6;
const LONG_PRESS_MS = 800;
const DOUBLE_CLICK_WINDOW_MS = 280;
const RAPID_CLICK_WINDOW_MS = 2000;
const RAPID_CLICK_THRESHOLD = 5;

export interface RecognizerCallbacks {
  onEvent: (event: InteractionEventType, areaId: string | null, clientX: number, clientY: number) => void;
  onDragStart: (areaId: string | null, initialDirection: "left" | "right" | null) => void;
  onDragEnd: (areaId: string | null) => void;
  findArea: (clientX: number, clientY: number) => { id: string; draggable?: boolean } | null;
  /** 是否允许触发互动事件（singleClick/doubleClick/longPress/rapidClick）*/
  isInteractionEnabled: () => boolean;
  /** 是否允许拖动（draggable 区域才可拖动，此开关全局控制）*/
  isDragEnabled: () => boolean;
  onPressStart?: () => void;
  onPressCancel?: () => void;
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
    if (e.button !== 0) return; // 仅左键

    const area = this.callbacks.findArea(e.clientX, e.clientY);
    if (!area) return; // 未命中

    // 手势允许拖动或互动之一即可建立 session
    const interactionOk = this.callbacks.isInteractionEnabled();
    const dragOk = this.callbacks.isDragEnabled();
    if (!interactionOk && !dragOk) return;

    console.log(`[gesture] pointerdown area=${area.id} interaction=${interactionOk} drag=${dragOk}`);

    // 设置 pointer capture 以接收 move/up（即使鼠标离开窗口）
    try {
      this.element.setPointerCapture(e.pointerId);
    } catch (err) {
      // ignore
    }

    this.session = {
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      pointerId: e.pointerId,
      areaId: area.id,
      draggable: area.draggable !== false && dragOk,
      startedAt: performance.now(),
      maxDistance: 0,
      phase: 'pending' as GesturePhase,
      longPressEligible: false,
      // 兼容旧字段
      dragging: false,
      nativeDragRequested: false,
      longPressTriggered: false,
      cancelled: false,
    };

    // 800ms 后只设 longPressEligible，不立即派发 longPress
    this.clearLongPressTimer();
    if (interactionOk) {
      const capturedClientX = e.clientX;
      const capturedClientY = e.clientY;
      this.longPressTimer = window.setTimeout(() => {
        if (
          this.session &&
          this.session.phase === 'pending' &&
          !this.session.cancelled
        ) {
          console.log(`[gesture] longPressEligible set (will commit on pointerup)`);
          this.session.longPressEligible = true;
          this.session.phase = 'longPressEligible';
          // 存储 clientX/Y 供 pointerup 时使用
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

    // 更新本次手势最大移动距离
    if (distance > this.session.maxDistance) {
      this.session.maxDistance = distance;
    }

    if (distance >= DRAG_THRESHOLD_PX) {
      console.log(`[gesture] drag-threshold distance=${distance.toFixed(1)}px`);

      // 超过阈值：清除所有计时器，永不再触发 longPress/click
      this.clearLongPressTimer();
      this.clearSingleClickTimer();

      if (this.session.draggable) {
        if (!this.session.nativeDragRequested) {
          this.session.phase = 'dragging';
          this.session.longPressEligible = false;
          this.session.dragging = true;
          this.session.nativeDragRequested = true;

          // 计算初始左右方向
          let initialDirection: "left" | "right" | null = null;
          if (Math.abs(deltaX) >= Math.abs(deltaY) && Math.abs(deltaX) >= DRAG_THRESHOLD_PX) {
            initialDirection = deltaX < 0 ? "left" : "right";
          }

          console.log(`[gesture] native-drag-start initialDirection=${initialDirection ?? 'vertical'}`);
          this.callbacks.onPressCancel?.();
          this.callbacks.onDragStart(this.session.areaId, initialDirection);

          // 释放 pointer capture 后再调 startDragging，避免 WebView capture 与 OS 拖动冲突
          try {
            this.element.releasePointerCapture(this.session.pointerId);
          } catch (_) { /* ignore */ }

          const dragStartAt = performance.now();
          try {
            await getCurrentWindow().startDragging();
          } catch (error) {
            console.error("[gesture] startDragging failed:", error);
          } finally {
            const elapsed = (performance.now() - dragStartAt).toFixed(0);
            console.log(`[gesture] startDragging-resolved elapsed=${elapsed}ms`);
            if (this.session) {
              this.session.dragging = false;
            }
            this.callbacks.onDragEnd(this.session ? this.session.areaId : null);
          }
        }
      } else if (this.session.phase === 'pending' || this.session.phase === 'longPressEligible') {
        // 不可拖动区域：超过阈值取消整个手势
        this.session.phase = 'cancelled';
        this.session.cancelled = true;
        this.clearTimers();
        this.callbacks.onPressCancel?.();
      }
    }
  };

  private handlePointerUp = (e: PointerEvent) => {
    // 释放 pointer capture
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }

    if (!this.session) return;

    console.log(`[gesture] pointerup phase=${this.session.phase} maxDistance=${this.session.maxDistance.toFixed(1)}px`);

    this.clearLongPressTimer();
    this.callbacks.onPressCancel?.();

    const phase = this.session.phase;

    if (phase === 'dragging' || this.session.nativeDragRequested) {
      // 拖动结束：onDragEnd 已在 finally 中调用，不触发 click/longPress
      this.session = null;
      return;
    }

    if (phase === 'cancelled') {
      this.session = null;
      return;
    }

    if (phase === 'longPressEligible') {
      // 延迟提交 longPress：现在才真正派发
      const lx = (this.session as any)._longPressClientX ?? e.clientX;
      const ly = (this.session as any)._longPressClientY ?? e.clientY;
      console.log(`[gesture] longPress committed on pointerup`);
      this.session.longPressTriggered = true;
      this.session.phase = 'longPressCommitted';
      this.callbacks.onEvent("longPress", this.session.areaId, lx, ly);
      this.session = null;
      return;
    }

    if (phase === 'longPressCommitted') {
      // 已提交 longPress：不再派发 click
      this.session = null;
      return;
    }

    // phase === 'pending'：进入单击/双击/快速点击判定
    if (!this.callbacks.isInteractionEnabled()) {
      this.session = null;
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
        // 第二次点击 → doubleClick
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
  };

  private handlePointerCancel = (e: PointerEvent) => {
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }

    if (this.session) {
      this.session.phase = 'cancelled';
      this.session.cancelled = true;
    }
    this.clearTimers();
    this.callbacks.onPressCancel?.();
    this.session = null;
  };
}
