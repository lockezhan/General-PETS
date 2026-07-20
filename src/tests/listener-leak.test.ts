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
      onDragStart: vi.fn(),
      onDragEnd: vi.fn()
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
});
