import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { HorizontalDirection } from './render/directional-animation-resolver';

export interface DragProgress {
  direction: HorizontalDirection;
  deltaLogicalX: number;
  totalLogicalDistance: number;
}

export interface DragDirectionState {
  active: boolean;
  previousX: number | null;
  currentDirection: HorizontalDirection | null;
  stableSamples: number;
  lastChangedAt: number;
  totalLogicalDistance: number;
  scaleFactor: number;
}

export class DragDirectionTracker {
  private state: DragDirectionState = {
    active: false,
    previousX: null,
    currentDirection: null,
    stableSamples: 0,
    lastChangedAt: 0,
    totalLogicalDistance: 0,
    scaleFactor: 1.0,
  };

  private unlistenFn: (() => void) | null = null;
  private onDirectionChange: (direction: HorizontalDirection) => void;
  private onMovementActivity: (progress: DragProgress) => void;

  private readonly DRAG_DIRECTION_THRESHOLD_PHYSICAL_PX = 3;
  private readonly DRAG_DIRECTION_DEBOUNCE_MS = 60;

  constructor(
    onDirectionChange: (direction: HorizontalDirection) => void,
    onMovementActivity: (progress: DragProgress) => void = () => {}
  ) {
    this.onDirectionChange = onDirectionChange;
    this.onMovementActivity = onMovementActivity;
    this.initListener().catch(console.error);
  }

  private async initListener() {
    const appWindow = getCurrentWindow();
    this.unlistenFn = await appWindow.onMoved((event) => {
      this.handleWindowMoved(event.payload);
    });
  }

  public startDrag(initialDirection: HorizontalDirection | null, scaleFactor: number = 1.0) {
    this.state.active = true;
    this.state.previousX = null;
    this.state.currentDirection = initialDirection;
    this.state.stableSamples = 0;
    this.state.lastChangedAt = performance.now();
    this.state.totalLogicalDistance = 0;
    this.state.scaleFactor = scaleFactor || 1.0;

    if (initialDirection) {
      console.log(`[drag-direction] started initial=${initialDirection}`);
      this.onDirectionChange(initialDirection);
    } else {
      console.log(`[drag-direction] started initial=none`);
    }
  }

  public setDirection(direction: HorizontalDirection) {
    if (!this.state.active) return;
    if (this.state.currentDirection !== direction) {
      console.log(`[drag-direction] changed ${this.state.currentDirection}->${direction}`);
      this.state.currentDirection = direction;
      this.state.lastChangedAt = performance.now();
      this.onDirectionChange(direction);
    }
  }

  private handleWindowMoved(position: PhysicalPosition) {
    if (!this.state.active) return;

    if (this.state.previousX === null) {
      this.state.previousX = position.x;
      return;
    }

    const deltaPhysicalX = position.x - this.state.previousX;
    this.state.previousX = position.x;

    if (Math.abs(deltaPhysicalX) < this.DRAG_DIRECTION_THRESHOLD_PHYSICAL_PX) {
      return;
    }

    const deltaLogicalX = deltaPhysicalX / this.state.scaleFactor;
    this.state.totalLogicalDistance += Math.abs(deltaLogicalX);

    const candidateDirection: HorizontalDirection = deltaPhysicalX > 0 ? "right" : "left";

    this.onMovementActivity({
      direction: candidateDirection,
      deltaLogicalX,
      totalLogicalDistance: this.state.totalLogicalDistance,
    });

    const now = performance.now();

    if (this.state.currentDirection === candidateDirection) {
      this.state.stableSamples = 0;
    } else {
      this.state.stableSamples++;
      const timeSinceChange = now - this.state.lastChangedAt;

      if (this.state.stableSamples >= 2 || timeSinceChange >= this.DRAG_DIRECTION_DEBOUNCE_MS) {
        const oldDir = this.state.currentDirection;
        this.state.currentDirection = candidateDirection;
        this.state.stableSamples = 0;
        this.state.lastChangedAt = now;
        
        console.log(`[drag-direction] changed ${oldDir}->${candidateDirection}`);
        this.onDirectionChange(candidateDirection);
      }
    }
  }

  public stopDrag() {
    if (this.state.active) {
      console.log(`[drag-direction] stopped`);
    }
    this.state.active = false;
    this.state.previousX = null;
    this.state.currentDirection = null;
    this.state.stableSamples = 0;
    this.state.totalLogicalDistance = 0;
  }

  public destroy() {
    this.stopDrag();
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
  }
}
