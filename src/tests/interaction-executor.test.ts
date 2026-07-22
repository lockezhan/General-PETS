import { describe, expect, it, vi } from 'vitest';
import { InteractionExecutor } from '../pet/interaction/interaction-executor';

describe('InteractionExecutor execution context', () => {
  it('passes the recognized event and area to animation and dialogue callbacks', () => {
    const playAnimation = vi.fn();
    const showDialogue = vi.fn();
    const executor = new InteractionExecutor({
      playAnimation,
      showDialogue,
      resetBehaviorTimer: vi.fn(),
      cancelMotion: vi.fn(),
      setFacing: vi.fn(),
      getRandomDialogueFromGroup: vi.fn().mockReturnValue('hello')
    });

    executor.executeActions([
      { type: 'playAnimation', animation: 'waving', fallback: 'idle' },
      { type: 'showDialogue', group: 'singleClick' }
    ], { event: 'singleClick', areaId: 'head' });

    expect(playAnimation).toHaveBeenCalledWith('waving', 'idle', {
      event: 'singleClick', areaId: 'head'
    });
    expect(showDialogue).toHaveBeenCalledWith('hello', {
      event: 'singleClick', areaId: 'head', dialogueGroup: 'singleClick'
    });
  });
});
