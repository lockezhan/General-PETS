import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { MotionController } from '../pet/motion-controller';
import { DEFAULT_SETTINGS } from '../shared/defaults';

const floorInfo = {
  monitorName: 'primary',
  scaleFactor: 1,
  workAreaLeft: 0,
  workAreaTop: 0,
  workAreaRight: 1920,
  workAreaBottom: 1080,
  floorWindowY: 800
};

async function settlePromises() {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('MotionController committed-position gait sync', () => {
  let frames: FrameRequestCallback[];
  let fakeWindow: {
    outerPosition: ReturnType<typeof vi.fn>;
    outerSize: ReturnType<typeof vi.fn>;
    setPosition: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(0);
    fakeWindow = {
      outerPosition: vi.fn().mockResolvedValue({ x: 100, y: 300 }),
      outerSize: vi.fn().mockResolvedValue({ width: 220, height: 260 }),
      setPosition: vi.fn()
    };
    vi.mocked(getCurrentWindow).mockReturnValue(fakeWindow as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not advance animation before IPC resolves and coalesces to the latest target', async () => {
    const resolvers: Array<() => void> = [];
    fakeWindow.setPosition.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    const onProgress = vi.fn();
    const controller = new MotionController();
    await controller.startWalk(100, 'right', 1000, floorInfo, DEFAULT_SETTINGS, vi.fn(), vi.fn(), onProgress);

    frames.shift()!(100);
    expect(fakeWindow.setPosition).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();

    frames.shift()!(200);
    expect(fakeWindow.setPosition).toHaveBeenCalledTimes(1);
    resolvers.shift()!();
    await settlePromises();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(fakeWindow.setPosition).toHaveBeenCalledTimes(2);

    resolvers.shift()!();
    await settlePromises();
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1][0].totalLogicalDistance).toBe(20);
    expect(onProgress.mock.calls[1][0].commitCount).toBe(2);
    controller.cancelActiveMotion('test complete');
  });

  it('does not advance committed distance after a failed position write', async () => {
    fakeWindow.setPosition.mockRejectedValueOnce(new Error('ipc failed')).mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const controller = new MotionController();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await controller.startWalk(100, 'right', 1000, floorInfo, DEFAULT_SETTINGS, vi.fn(), vi.fn(), onProgress);

    frames.shift()!(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(onProgress).not.toHaveBeenCalled();

    frames.shift()!(200);
    await Promise.resolve();
    await Promise.resolve();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls[0][0].totalLogicalDistance).toBe(20);
    errorSpy.mockRestore();
    controller.cancelActiveMotion('test complete');
  });

  it('flushes the final position before reporting walk completion', async () => {
    let resolvePosition!: () => void;
    fakeWindow.setPosition.mockImplementation(() => new Promise<void>((resolve) => { resolvePosition = resolve; }));
    const order: string[] = [];
    const controller = new MotionController();
    await controller.startWalk(
      100, 'right', 100, floorInfo, DEFAULT_SETTINGS, vi.fn(),
      () => order.push('complete'),
      () => order.push('progress')
    );

    frames.shift()!(100);
    expect(order).toEqual([]);
    resolvePosition();
    await settlePromises();
    expect(order).toEqual(['progress', 'complete']);
  });

  it('waits for the coalesced latest target before completing', async () => {
    const resolvers: Array<() => void> = [];
    fakeWindow.setPosition.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    const onComplete = vi.fn();
    const controller = new MotionController();
    await controller.startWalk(100, 'right', 200, floorInfo, DEFAULT_SETTINGS, vi.fn(), onComplete, vi.fn());

    frames.shift()!(100);
    frames.shift()!(200);
    expect(fakeWindow.setPosition).toHaveBeenCalledTimes(1);
    resolvers.shift()!();
    await settlePromises();
    expect(fakeWindow.setPosition).toHaveBeenCalledTimes(2);
    expect(onComplete).not.toHaveBeenCalled();

    resolvers.shift()!();
    await settlePromises();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
