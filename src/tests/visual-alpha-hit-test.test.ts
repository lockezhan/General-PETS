import { describe, expect, it, vi } from 'vitest';
import { isCanvasPointOpaque, MIN_INTERACTIVE_ALPHA } from '../pet/interaction/visual-alpha-hit-test';

describe('visual alpha hit testing', () => {
  it('maps scaled client coordinates to the physical canvas pixel', () => {
    const getImageData = vi.fn().mockReturnValue({ data: new Uint8ClampedArray([0, 0, 0, 255]) });
    const canvas = {
      width: 384,
      height: 416,
      getContext: vi.fn().mockReturnValue({ getImageData }),
    } as unknown as HTMLCanvasElement;
    const rect = new DOMRect(40, 60, 96, 104);

    expect(isCanvasPointOpaque(canvas, 88, 112, rect)).toBe(true);
    expect(getImageData).toHaveBeenCalledWith(192, 208, 1, 1);
  });

  it('rejects transparent and antialias fringe pixels', () => {
    const alpha = { value: 0 };
    const canvas = {
      width: 192,
      height: 208,
      getContext: vi.fn().mockReturnValue({
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, alpha.value]) })),
      }),
    } as unknown as HTMLCanvasElement;
    const rect = new DOMRect(0, 0, 192, 208);

    expect(isCanvasPointOpaque(canvas, 96, 104, rect)).toBe(false);
    alpha.value = MIN_INTERACTIVE_ALPHA - 1;
    expect(isCanvasPointOpaque(canvas, 96, 104, rect)).toBe(false);
    alpha.value = MIN_INTERACTIVE_ALPHA;
    expect(isCanvasPointOpaque(canvas, 96, 104, rect)).toBe(true);
  });

  it('rejects points outside the visual surface without reading canvas data', () => {
    const getImageData = vi.fn();
    const canvas = {
      width: 192,
      height: 208,
      getContext: vi.fn().mockReturnValue({ getImageData }),
    } as unknown as HTMLCanvasElement;
    const rect = new DOMRect(100, 100, 192, 208);

    expect(isCanvasPointOpaque(canvas, 99, 150, rect)).toBe(false);
    expect(getImageData).not.toHaveBeenCalled();
  });
});
