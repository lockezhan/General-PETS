import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnimationClock } from '../pet/render/animation-clock';
import { AnimationTiming } from '../shared/character-types';

describe('AnimationClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should advance frames according to frameDurationMs', () => {
    const frames: number[] = [];
    const clock = new AnimationClock({
      onFrameChange: (idx) => frames.push(idx),
      onComplete: () => {}
    });

    const timing: AnimationTiming = {
      frameDurationMs: 100,
      loop: true
    };

    clock.play('test', timing, 3, 1.0);

    // Initial frame index 0 on play
    expect(frames).toEqual([0]);

    // Tick 100ms -> should advance to frame 1
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1]);

    // Tick another 100ms -> should advance to frame 2
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1, 2]);

    clock.destroy();
  });

  it('should apply speed multiplier correctly', () => {
    const frames: number[] = [];
    const clock = new AnimationClock({
      onFrameChange: (idx) => frames.push(idx),
      onComplete: () => {}
    });

    const timing: AnimationTiming = {
      frameDurationMs: 100,
      loop: true
    };

    // Speed 1.5x -> 100ms / 1.5 = 66.7ms per frame
    clock.play('test', timing, 3, 1.5);
    expect(frames).toEqual([0]);

    vi.advanceTimersByTime(70);
    expect(frames).toEqual([0, 1]);

    // Update speed to 0.5x -> 100ms / 0.5 = 200ms per frame
    clock.updateSpeedMultiplier(0.5);
    
    // Total 100ms passed -> shouldn't advance yet (requires 200ms)
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1]);

    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1, 2]);

    clock.destroy();
  });

  it('should support per-frame duration array', () => {
    const frames: number[] = [];
    const clock = new AnimationClock({
      onFrameChange: (idx) => frames.push(idx),
      onComplete: () => {}
    });

    const timing: AnimationTiming = {
      frameDurationMs: 100,
      frameDurationsMs: [150, 80, 200],
      loop: true
    };

    clock.play('test', timing, 3, 1.0);
    expect(frames).toEqual([0]);

    // Frame 0 needs 150ms
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0]);
    vi.advanceTimersByTime(50);
    expect(frames).toEqual([0, 1]);

    // Frame 1 needs 80ms
    vi.advanceTimersByTime(80);
    expect(frames).toEqual([0, 1, 2]);

    clock.destroy();
  });

  it('should support lastFrameDurationMs extension', () => {
    const frames: number[] = [];
    const clock = new AnimationClock({
      onFrameChange: (idx) => frames.push(idx),
      onComplete: () => {}
    });

    const timing: AnimationTiming = {
      frameDurationMs: 100,
      lastFrameDurationMs: 500,
      loop: true
    };

    clock.play('test', timing, 3, 1.0);
    expect(frames).toEqual([0]);

    vi.advanceTimersByTime(100); // to frame 1
    vi.advanceTimersByTime(100); // to frame 2 (last frame)
    expect(frames).toEqual([0, 1, 2]);

    // Last frame needs 500ms before looping back to 0
    vi.advanceTimersByTime(300);
    expect(frames).toEqual([0, 1, 2]);

    vi.advanceTimersByTime(200);
    expect(frames).toEqual([0, 1, 2, 0]);

    clock.destroy();
  });

  it('should support loopDelayMs and loopDelayRangeMs', () => {
    const frames: number[] = [];
    const clock = new AnimationClock({
      onFrameChange: (idx) => frames.push(idx),
      onComplete: () => {}
    });

    const timing: AnimationTiming = {
      frameDurationMs: 100,
      loop: true,
      holdFrameIndex: 1,
      loopDelayMs: 2000
    };

    clock.play('test', timing, 3, 1.0);
    expect(frames).toEqual([0]);

    vi.advanceTimersByTime(100); // frame 1
    vi.advanceTimersByTime(100); // frame 2
    expect(frames).toEqual([0, 1, 2]);

    // After frame 2, it loops. Since loopDelayMs=2000, it stays at holdFrameIndex=1 for 2000ms
    vi.advanceTimersByTime(100);
    expect(frames).toEqual([0, 1, 2, 1]); // loops back to hold frame

    // Stays at hold frame
    vi.advanceTimersByTime(1500);
    expect(frames).toEqual([0, 1, 2, 1]);

    // Tick remainder of delay -> next loop starts from frame 0
    vi.advanceTimersByTime(500);
    expect(frames).toEqual([0, 1, 2, 1, 0]);

    clock.destroy();
  });

  it('should invoke onComplete for non-looping animations', () => {
    let fallbackState = '';
    const clock = new AnimationClock({
      onFrameChange: () => {},
      onComplete: (st) => { fallbackState = st; }
    });

    const timing: AnimationTiming = {
      frameDurationMs: 100,
      loop: false,
      fallback: 'custom-idle'
    };

    clock.play('test', timing, 3, 1.0);
    vi.advanceTimersByTime(100); // to 1
    vi.advanceTimersByTime(100); // to 2
    vi.advanceTimersByTime(100); // triggers complete
    expect(fallbackState).toBe('custom-idle');

    clock.destroy();
  });

  it('should pause and resume correctly', () => {
    const frames: number[] = [];
    const clock = new AnimationClock({
      onFrameChange: (idx) => frames.push(idx),
      onComplete: () => {}
    });

    const timing: AnimationTiming = {
      frameDurationMs: 100,
      loop: true
    };

    clock.play('test', timing, 3, 1.0);
    expect(frames).toEqual([0]);

    vi.advanceTimersByTime(60);
    clock.pause();

    // Ticking while paused should do nothing
    vi.advanceTimersByTime(200);
    expect(frames).toEqual([0]);

    clock.resume();
    // Needs remaining 40ms to advance
    vi.advanceTimersByTime(20);
    expect(frames).toEqual([0]);
    vi.advanceTimersByTime(20);
    expect(frames).toEqual([0, 1]);

    clock.destroy();
  });
});
