import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionController, InteractionControllerCallbacks } from '../pet/interaction-controller';
import { DEFAULT_SETTINGS } from '../shared/defaults';

describe('InteractionController Event Listeners', () => {
  let element: HTMLElement;
  let spriteImg: HTMLImageElement;
  let debugOverlayDiv: HTMLDivElement;
  let callbacks: InteractionControllerCallbacks;

  beforeEach(() => {
    element = document.createElement('div');
    spriteImg = document.createElement('img');
    debugOverlayDiv = document.createElement('div');
    callbacks = {
      playAnimation: vi.fn(),
      showDialogue: vi.fn(),
      resetBehaviorTimer: vi.fn(),
      cancelMotion: vi.fn(),
      setFacing: vi.fn(),
      getRandomDialogueFromGroup: vi.fn(),
      getCurrentState: vi.fn().mockReturnValue('idle'),
      getFacing: vi.fn().mockReturnValue('right'),
      hasAnimation: vi.fn().mockReturnValue(true),
      onDragStart: vi.fn(),
      onDragMove: vi.fn(),
      onDragEnd: vi.fn(),
      onPressVisualStart: vi.fn(),
      onPressVisualCancel: vi.fn()
    };
  });

  it('should not add new event listeners during character switch / context update', () => {
    // Spy on addEventListener
    const addEventListenerSpy = vi.spyOn(element, 'addEventListener');
    const windowAddEventListenerSpy = vi.spyOn(window, 'addEventListener');

    const controller = new InteractionController(
      element,
      spriteImg,
      debugOverlayDiv,
      DEFAULT_SETTINGS,
      callbacks
    );

    // Initial count of listeners added
    const initialElementListeners = addEventListenerSpy.mock.calls.length;
    const initialWindowListeners = windowAddEventListenerSpy.mock.calls.length;

    expect(initialElementListeners).toBeGreaterThan(0);
    expect(initialWindowListeners).toBeGreaterThan(0);

    // Simulate switching character multiple times
    for (let i = 0; i < 5; i++) {
      controller.updateCharacterContext(
        {
          schemaVersion: 1,
          hitAreas: [],
          rules: []
        },
        {},
        true
      );
    }

    // Verify that NO new event listeners were added after the initial setup
    expect(addEventListenerSpy.mock.calls.length).toBe(initialElementListeners);
    expect(windowAddEventListenerSpy.mock.calls.length).toBe(initialWindowListeners);

    // Destroy and verify clean up
    const removeEventListenerSpy = vi.spyOn(element, 'removeEventListener');
    const windowRemoveEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    controller.destroy();

    // Verify removeEventListener is called for every added listener
    expect(removeEventListenerSpy.mock.calls.length).toBeGreaterThan(0);
    expect(windowRemoveEventListenerSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('should use the visible Codex viewport instead of the hidden sprite bounds', () => {
    const viewport = document.createElement('div');
    viewport.className = 'codex-frame-viewport';
    const viewportRect = new DOMRect(40, 60, 144, 156);
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(viewportRect);
    vi.spyOn(spriteImg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
    viewport.appendChild(spriteImg);
    element.appendChild(viewport);

    const controller = new InteractionController(
      element,
      spriteImg,
      debugOverlayDiv,
      DEFAULT_SETTINGS,
      callbacks
    );

    expect((controller as any).getVisualInteractionRect()).toBe(viewportRect);
    controller.destroy();
  });

  it('requires an opaque Codex canvas pixel before returning a configured hit area', () => {
    const viewport = document.createElement('div');
    viewport.className = 'codex-frame-viewport';
    const canvas = document.createElement('canvas');
    canvas.className = 'codex-frame-canvas';
    canvas.width = 192;
    canvas.height = 208;
    const viewportRect = new DOMRect(40, 60, 192, 208);
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(viewportRect);
    const getImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData } as any);
    viewport.append(canvas, spriteImg);
    element.appendChild(viewport);

    const controller = new InteractionController(
      element,
      spriteImg,
      debugOverlayDiv,
      DEFAULT_SETTINGS,
      callbacks
    );
    getImageData.mockReturnValueOnce({ data: new Uint8ClampedArray([0, 0, 0, 0]) });
    expect((controller as any).findHitAreaAtPoint(136, 164, viewportRect, 'right')).toBeNull();

    getImageData.mockReturnValueOnce({ data: new Uint8ClampedArray([0, 0, 0, 255]) });
    expect((controller as any).findHitAreaAtPoint(136, 164, viewportRect, 'right')?.id).toBe('body');
    controller.destroy();
  });
});
