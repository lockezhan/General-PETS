import { describe, expect, it } from 'vitest';
import { calculatePetVisualLayout } from '../pet/visual-layout';

describe('calculatePetVisualLayout', () => {
  it.each([0.5, 0.75, 1, 1.25, 1.5])(
    'keeps the full 192x208 Codex frame inside a symmetrically padded window at %sx',
    (scale) => {
      const layout = calculatePetVisualLayout(192, 208, scale);

      expect(layout.stageWidth).toBe(Math.round(192 * scale));
      expect(layout.stageHeight).toBe(Math.round(208 * scale));
      expect(layout.windowWidth).toBeGreaterThanOrEqual(layout.stageWidth + 32);
      expect(layout.windowHeight).toBeGreaterThanOrEqual(layout.stageHeight + 72);
    }
  );
});
