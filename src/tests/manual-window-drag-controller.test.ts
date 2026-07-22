import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  ManualWindowDragController,
  ManualDragProgress
} from '../pet/manual-window-drag-controller';

describe('ManualWindowDragController', () => {
  let fakeWindow: {
    outerPosition: ReturnType<typeof vi.fn>;
    scaleFactor: ReturnType<typeof vi.fn>;
    setPosition: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    fakeWindow = {
      outerPosition: vi.fn().mockResolvedValue({ x: 100, y: 400 }),
      scaleFactor: vi.fn().mockResolvedValue(2),
      setPosition: vi.fn().mockResolvedValue(undefined)
    };
    vi.mocked(getCurrentWindow).mockReturnValue(fakeWindow as any);
  });

  it('converts pointer movement to physical window position and reports logical progress', async () => {
    const progress: ManualDragProgress[] = [];
    const controller = new ManualWindowDragController((value) => progress.push(value));

    await controller.begin(50, 100);
    vi.advanceTimersByTime(20);
    controller.update(60, 100);
    vi.runOnlyPendingTimers();
    await Promise.resolve();

    const latest = progress[progress.length - 1];
    expect(latest?.totalLogicalX).toBe(5);
    expect(latest?.totalLogicalY).toBe(0);
    expect(fakeWindow.setPosition).toHaveBeenCalledWith(
      expect.objectContaining({ x: 120, y: 400 })
    );

    const summary = await controller.end('pointerup');
    expect(summary.startPhysicalX).toBe(100);
    expect(summary.endPhysicalX).toBe(120);
    expect(summary.predominantlyVertical).toBe(false);
  });

  it('tracks upward lift and distinguishes a vertical drag', async () => {
    const controller = new ManualWindowDragController();
    await controller.begin(50, 100);
    vi.advanceTimersByTime(20);
    controller.update(50, 60);

    const summary = await controller.end('pointerup');
    expect(summary.maximumUpwardLiftLogical).toBe(20);
    expect(summary.totalLogicalY).toBe(-20);
    expect(summary.predominantlyVertical).toBe(true);
  });
});
