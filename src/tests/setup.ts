import { vi } from 'vitest';

vi.mock('@tauri-apps/api/window', () => {
  return {
    getCurrentWindow: () => ({
      startDragging: vi.fn().mockResolvedValue(undefined),
      outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
      outerSize: vi.fn().mockResolvedValue({ width: 220, height: 260 }),
      scaleFactor: vi.fn().mockResolvedValue(1),
      onMoved: vi.fn(),
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      setSize: vi.fn().mockResolvedValue(undefined),
      setPosition: vi.fn().mockResolvedValue(undefined),
    }),
    currentMonitor: vi.fn().mockResolvedValue({
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
      scaleFactor: 1
    }),
    primaryMonitor: vi.fn().mockResolvedValue({
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
      scaleFactor: 1
    })
  };
});

vi.mock('@tauri-apps/plugin-store', () => {
  return {
    load: vi.fn().mockResolvedValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      save: vi.fn().mockResolvedValue(undefined),
    })
  };
});

vi.mock('@tauri-apps/api/event', () => {
  return {
    listen: vi.fn().mockResolvedValue(vi.fn()),
    emitTo: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock browser global APIs if needed (like DOMRect)
global.DOMRect = class DOMRect {
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  top = 0;
  right = 0;
  bottom = 0;
  left = 0;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.top = y;
    this.left = x;
    this.bottom = y + height;
    this.right = x + width;
  }
  toJSON() {
    return JSON.stringify(this);
  }
} as any;
