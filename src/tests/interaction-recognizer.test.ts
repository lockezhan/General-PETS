import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionRecognizer, RecognizerCallbacks } from '../pet/interaction/interaction-recognizer';
import { InteractionEventType } from '../pet/interaction/interaction-types';

describe('InteractionRecognizer', () => {
  let element: HTMLElement;
  let callbacks: RecognizerCallbacks;
  let eventsDispatched: Array<{ event: InteractionEventType; areaId: string | null }>;
  let dragStarted = false;
  let dragEnded = false;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement('div');
    eventsDispatched = [];
    dragStarted = false;

    callbacks = {
      onEvent: (event, areaId) => {
        eventsDispatched.push({ event, areaId });
      },
      onDragStart: (_areaId, _initialDirection) => {
        dragStarted = true;
      },
      onDragEnd: () => {
        dragEnded = true;
      },
      findArea: () => ({ id: 'head', draggable: true }),
      isInteractionEnabled: () => true,
      isDragEnabled: () => true,
      isAdvancedPettingEnabled: () => false
    };
  });

  const firePointerDown = (el: HTMLElement, x = 100, y = 100, button = 0) => {
    const e = new PointerEvent('pointerdown', { clientX: x, clientY: y, screenX: x, screenY: y, button, bubbles: true });
    el.dispatchEvent(e);
  };

  const firePointerMove = (_el: HTMLElement, x = 100, y = 100) => {
    const e = new PointerEvent('pointermove', { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true });
    window.dispatchEvent(e);
  };

  const firePointerUp = (_el: HTMLElement, x = 100, y = 100) => {
    const e = new PointerEvent('pointerup', { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true });
    window.dispatchEvent(e);
  };

  it('should trigger singleClick after double click window delay', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element);
    firePointerUp(element);

    expect(eventsDispatched.length).toBe(0); // not immediately triggered

    // Fast-forward double click window (280ms)
    vi.advanceTimersByTime(280);

    expect(eventsDispatched.length).toBe(1);
    expect(eventsDispatched[0]).toEqual({ event: 'singleClick', areaId: 'head' });

    recognizer.unbindEvents();
  });

  it('should trigger doubleClick when clicked twice quickly, and not trigger singleClick', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    // Click 1
    firePointerDown(element);
    firePointerUp(element);
    vi.advanceTimersByTime(100);

    // Click 2
    firePointerDown(element);
    firePointerUp(element);

    expect(eventsDispatched.length).toBe(1);
    expect(eventsDispatched[0]).toEqual({ event: 'doubleClick', areaId: 'head' });

    // Wait and verify no single click is triggered later
    vi.advanceTimersByTime(300);
    expect(eventsDispatched.length).toBe(1);

    recognizer.unbindEvents();
  });

  it('should trigger longPress immediately at the 650ms threshold', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element);

    // Threshold commit happens while the pointer is still held.
    vi.advanceTimersByTime(651);
    expect(eventsDispatched.length).toBe(1);
    expect(eventsDispatched[0]).toEqual({ event: 'longPress', areaId: 'head' });

    // Release mouse -> triggers now
    firePointerUp(element);

    expect(eventsDispatched.length).toBe(1);

    // Verify no single or double click fires after release
    vi.advanceTimersByTime(300);
    expect(eventsDispatched.length).toBe(1); // Still only 1 event

    recognizer.unbindEvents();
  });

  it('should not commit longPress at 649ms', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element);
    vi.advanceTimersByTime(649);

    expect(eventsDispatched).toHaveLength(0);
    firePointerUp(element);
    vi.advanceTimersByTime(300);
    expect(eventsDispatched).toContainEqual({ event: 'singleClick', areaId: 'head' });
    recognizer.unbindEvents();
  });

  it('should enter drag before the longPress threshold and cancel longPress', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element, 100, 100);
    vi.advanceTimersByTime(400);
    firePointerMove(element, 109, 100);

    expect(dragStarted).toBe(true);
    vi.advanceTimersByTime(400);
    expect(eventsDispatched).toHaveLength(0);
    firePointerUp(element, 109, 100);
    expect(dragEnded).toBe(true);
    recognizer.unbindEvents();
  });

  it('should initiate drag when mouse moves past threshold, and cancel pending timers', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element, 100, 100);

    // Move slightly (under threshold 6px)
    firePointerMove(element, 102, 100);
    expect(dragStarted).toBe(false);

    // Move past threshold (8px)
    firePointerMove(element, 108, 100);
    expect(dragStarted).toBe(true);

    // Advance time and check that longPress is cancelled (didn't fire after 800ms)
    vi.advanceTimersByTime(850);
    expect(eventsDispatched.length).toBe(0);

    // Release
    firePointerUp(element, 108, 100);
    expect(dragEnded).toBe(true);
    // Verify no click is triggered on release
    vi.advanceTimersByTime(300);
    expect(eventsDispatched.length).toBe(0);

    recognizer.unbindEvents();
  });

  it('should trigger rapidClick when clicked 5 times within 2 seconds', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    for (let i = 0; i < 5; i++) {
      firePointerDown(element);
      firePointerUp(element);
      vi.advanceTimersByTime(100); // 100ms between clicks
    }

    // Should immediately trigger rapidClick on the 5th click, and cancel pending single click
    expect(eventsDispatched).toContainEqual({ event: 'rapidClick', areaId: 'head' });
    expect(eventsDispatched.some(e => e.event === 'singleClick')).toBe(false);

    // Wait to verify no delayed single clicks fire
    vi.advanceTimersByTime(500);
    expect(eventsDispatched.some(e => e.event === 'singleClick')).toBe(false);

    recognizer.unbindEvents();
  });

  it('should not register events on right click', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element, 100, 100, 2); // Right click is button=2
    firePointerUp(element);

    vi.advanceTimersByTime(300);
    expect(eventsDispatched.length).toBe(0);

    recognizer.unbindEvents();
  });

  it('should not enter drag after longPress has already committed', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element, 100, 100);
    vi.advanceTimersByTime(650);

    // Now move past threshold (9px > 8px)
    firePointerMove(element, 109, 100);
    expect(dragStarted).toBe(false);
    expect(eventsDispatched).toContainEqual({ event: 'longPress', areaId: 'head' });

    firePointerUp(element, 109, 100);
    vi.advanceTimersByTime(300);

    // Only the already-committed longPress is present.
    expect(eventsDispatched.length).toBe(1);
    recognizer.unbindEvents();
  });

  it('should not dispatch a second longPress on pointerup', () => {
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element, 100, 100);
    vi.advanceTimersByTime(651);

    expect(eventsDispatched.length).toBe(1);

    firePointerUp(element, 100, 100);
    // Pointerup only cleans up the committed gesture.
    expect(eventsDispatched.length).toBe(1);

    recognizer.unbindEvents();
  });

  it('should allow drag but prevent clicks when interaction is disabled', () => {
    callbacks.isInteractionEnabled = () => false;
    const recognizer = new InteractionRecognizer(element, callbacks);

    firePointerDown(element, 100, 100);
    firePointerMove(element, 108, 100);
    expect(dragStarted).toBe(true);

    firePointerUp(element, 108, 100);
    vi.advanceTimersByTime(300);

    expect(eventsDispatched.length).toBe(0);
    recognizer.unbindEvents();
  });
});
