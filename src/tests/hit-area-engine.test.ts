import { describe, it, expect } from 'vitest';
import { HitAreaEngine } from '../pet/interaction/hit-area-engine';
import { HitAreaShape } from '../pet/interaction/interaction-types';
import { DEFAULT_CODEX_HIT_AREAS } from '../pet/natural/natural-types';

describe('HitAreaEngine', () => {
  const spriteRect = new DOMRect(100, 100, 200, 200); // left=100, top=100, width=200, height=200

  it('should correctly normalize and hit detect a rectangular area', () => {
    const areas: HitAreaShape[] = [
      {
        id: 'rect1',
        name: 'Rectangle 1',
        shape: 'rect',
        x: 0.2,
        y: 0.2,
        width: 0.6,
        height: 0.4,
        priority: 10
      }
    ];

    const engine = new HitAreaEngine(areas, true);

    // Hit inside (x=0.5, y=0.4 in normalized space)
    // clientX = 100 + 0.5 * 200 = 200
    // clientY = 100 + 0.4 * 200 = 180
    const hit = engine.findHitArea(200, 180, spriteRect, 'right');
    expect(hit).toBeDefined();
    expect(hit?.id).toBe('rect1');

    // Hit outside
    const miss = engine.findHitArea(120, 120, spriteRect, 'right'); // x=0.1, y=0.1
    expect(miss).toBeNull();
  });

  it('should correctly hit detect an elliptical area', () => {
    const areas: HitAreaShape[] = [
      {
        id: 'ellipse1',
        name: 'Ellipse 1',
        shape: 'ellipse',
        cx: 0.5,
        cy: 0.5,
        rx: 0.3,
        ry: 0.2,
        priority: 10
      }
    ];

    const engine = new HitAreaEngine(areas, true);

    // Hit inside (dx^2/rx^2 + dy^2/ry^2 = (0.1)^2/(0.3)^2 + (0.1)^2/(0.2)^2 = 0.01/0.09 + 0.01/0.04 = 0.11 + 0.25 = 0.36 <= 1)
    // clientX = 100 + 0.6 * 200 = 220
    // clientY = 100 + 0.6 * 200 = 220
    const hit = engine.findHitArea(220, 220, spriteRect, 'right');
    expect(hit).toBeDefined();
    expect(hit?.id).toBe('ellipse1');

    // Hit outside (dx=0.4, dy=0) -> 0.16/0.09 > 1
    const miss = engine.findHitArea(280, 200, spriteRect, 'right');
    expect(miss).toBeNull();
  });

  it('should correctly hit detect a polygon area', () => {
    const areas: HitAreaShape[] = [
      {
        id: 'poly1',
        name: 'Polygon 1',
        shape: 'polygon',
        points: [
          [0.3, 0.3],
          [0.7, 0.3],
          [0.7, 0.7],
          [0.3, 0.7]
        ],
        priority: 10
      }
    ];

    const engine = new HitAreaEngine(areas, true);

    // Inside (x=0.5, y=0.5)
    const hit = engine.findHitArea(200, 200, spriteRect, 'right');
    expect(hit).toBeDefined();
    expect(hit?.id).toBe('poly1');

    // Outside (x=0.2, y=0.5)
    const miss = engine.findHitArea(140, 200, spriteRect, 'right');
    expect(miss).toBeNull();
  });

  it('should resolve overlapping areas based on priority', () => {
    const areas: HitAreaShape[] = [
      {
        id: 'low-pri',
        shape: 'rect',
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
        priority: 10
      },
      {
        id: 'high-pri',
        shape: 'rect',
        x: 0.3,
        y: 0.3,
        width: 0.4,
        height: 0.4,
        priority: 50
      }
    ];

    const engine = new HitAreaEngine(areas, true);

    // Hit in the overlapping region (x=0.5, y=0.5)
    const hit = engine.findHitArea(200, 200, spriteRect, 'right');
    expect(hit).toBeDefined();
    expect(hit?.id).toBe('high-pri'); // returns higher priority first

    // Hit only in low-pri region (x=0.2, y=0.2)
    const hitLow = engine.findHitArea(140, 140, spriteRect, 'right');
    expect(hitLow).toBeDefined();
    expect(hitLow?.id).toBe('low-pri');
  });

  it('should correctly handle horizontal flip when facing left', () => {
    const areas: HitAreaShape[] = [
      {
        id: 'left-side',
        shape: 'rect',
        x: 0.0,
        y: 0.0,
        width: 0.4,
        height: 1.0,
        priority: 10
      }
    ];

    const engine = new HitAreaEngine(areas, true);

    // Facing right: hit left side (clientX=120 -> x=0.1) -> should hit
    const hitRight = engine.findHitArea(120, 200, spriteRect, 'right');
    expect(hitRight).toBeDefined();
    expect(hitRight?.id).toBe('left-side');

    // Facing left: clientX=120 (x=0.1) gets flipped to x=0.9 -> should miss left-side (which is x=0 to 0.4)
    const hitLeftMiss = engine.findHitArea(120, 200, spriteRect, 'left');
    expect(hitLeftMiss).toBeNull();

    // Facing left: clientX=280 (x=0.9) gets flipped to x=0.1 -> should hit left-side
    const hitLeftHit = engine.findHitArea(280, 200, spriteRect, 'left');
    expect(hitLeftHit).toBeDefined();
    expect(hitLeftHit?.id).toBe('left-side');
  });

  it('should protect against bounds violation and NaN/Infinity', () => {
    const areas: HitAreaShape[] = [
      {
        id: 'full',
        shape: 'rect',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        priority: 10
      }
    ];

    const engine = new HitAreaEngine(areas, true);

    // Out of bounds
    expect(engine.findHitArea(50, 200, spriteRect, 'right')).toBeNull(); // x = -0.25
    expect(engine.findHitArea(350, 200, spriteRect, 'right')).toBeNull(); // x = 1.25

    // NaN / Infinity safety
    expect(engine.findHitArea(NaN, 200, spriteRect, 'right')).toBeNull();
    expect(engine.findHitArea(200, Infinity, spriteRect, 'right')).toBeNull();
  });

  it('should fall back to full-body rectangle for legacy characters', () => {
    const engine = new HitAreaEngine(undefined, true);
    
    // Default virtual body area covering 0 to 1 should be generated
    const hit = engine.findHitArea(200, 200, spriteRect, 'right');
    expect(hit).toBeDefined();
    expect(hit?.id).toBe('body');
    expect(hit?.draggable).toBe(true);
    expect(hit?.priority).toBe(0);
  });

  it('should keep precise areas ahead of the whole-pet Codex fallback', () => {
    const engine = new HitAreaEngine(DEFAULT_CODEX_HIT_AREAS as HitAreaShape[], false);

    expect(engine.findHitArea(200, 150, spriteRect, 'right')?.id).toBe('face');
    expect(engine.findHitArea(105, 295, spriteRect, 'right')?.id).toBe('whole-pet');
    expect(engine.findHitArea(295, 295, spriteRect, 'right')?.id).toBe('whole-pet');
    expect(DEFAULT_CODEX_HIT_AREAS).toHaveLength(4);
  });
});
