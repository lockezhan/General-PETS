import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';

export interface ManualDragProgress {
  deltaLogicalX: number;
  deltaLogicalY: number;
  totalLogicalX: number;
  totalLogicalY: number;
  totalHorizontalDistance: number;
  velocityX: number;
  velocityY: number;
  direction: 'left' | 'right' | null;
  positionX: number;
  positionY: number;
}

export interface ManualDragSummary {
  startPhysicalX: number;
  startPhysicalY: number;
  endPhysicalX: number;
  endPhysicalY: number;
  totalLogicalX: number;
  totalLogicalY: number;
  maximumUpwardLiftLogical: number;
  predominantlyVertical: boolean;
  moved: boolean;
}

export type ManualDragProgressCallback = (progress: ManualDragProgress) => void;

export class ManualWindowDragController {
  private active = false;
  private ready = false;
  private startPointerX = 0;
  private startPointerY = 0;
  private latestPointerX = 0;
  private latestPointerY = 0;
  private startWindowX = 0;
  private startWindowY = 0;
  private desiredWindowX = 0;
  private desiredWindowY = 0;
  private lastSentWindowX = 0;
  private lastSentWindowY = 0;
  private scaleFactor = 1;
  private totalLogicalX = 0;
  private totalLogicalY = 0;
  private maximumUpwardLiftLogical = 0;
  private lastSampleX = 0;
  private lastSampleY = 0;
  private lastSampleAt = 0;
  private smoothedVelocityX = 0;
  private smoothedVelocityY = 0;
  private direction: 'left' | 'right' | null = null;
  private pendingDirection: 'left' | 'right' | null = null;
  private pendingDirectionSince = 0;
  private positionFrame: number | null = null;
  private positionPromise: Promise<void> | null = null;
  private hasPendingPosition = false;
  private onProgress: ManualDragProgressCallback;

  constructor(onProgress: ManualDragProgressCallback = () => {}) {
    this.onProgress = onProgress;
  }

  public async begin(pointerScreenX: number, pointerScreenY: number): Promise<void> {
    if (this.positionPromise) {
      await this.positionPromise;
    }
    this.cancel('new session');
    this.active = true;
    this.ready = false;
    this.startPointerX = pointerScreenX;
    this.startPointerY = pointerScreenY;
    this.latestPointerX = pointerScreenX;
    this.latestPointerY = pointerScreenY;
    this.totalLogicalX = 0;
    this.totalLogicalY = 0;
    this.maximumUpwardLiftLogical = 0;
    this.direction = null;
    this.pendingDirection = null;
    this.pendingDirectionSince = 0;
    this.smoothedVelocityX = 0;
    this.smoothedVelocityY = 0;

    const appWindow = getCurrentWindow();
    const [position, scaleFactor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.scaleFactor()
    ]);

    if (!this.active) return;

    this.startWindowX = position.x;
    this.startWindowY = position.y;
    this.desiredWindowX = position.x;
    this.desiredWindowY = position.y;
    this.lastSentWindowX = position.x;
    this.lastSentWindowY = position.y;
    this.hasPendingPosition = false;
    this.scaleFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
    this.lastSampleX = pointerScreenX;
    this.lastSampleY = pointerScreenY;
    this.lastSampleAt = performance.now();
    this.ready = true;

    if (this.latestPointerX !== pointerScreenX || this.latestPointerY !== pointerScreenY) {
      this.update(this.latestPointerX, this.latestPointerY);
    }
  }

  public update(pointerScreenX: number, pointerScreenY: number): void {
    if (!this.active) return;

    this.latestPointerX = pointerScreenX;
    this.latestPointerY = pointerScreenY;
    if (!this.ready) return;

    const now = performance.now();
    const elapsedSeconds = Math.max((now - this.lastSampleAt) / 1000, 0.001);
    const deltaLogicalX = (pointerScreenX - this.lastSampleX) / this.scaleFactor;
    const deltaLogicalY = (pointerScreenY - this.lastSampleY) / this.scaleFactor;
    const velocityX = deltaLogicalX / elapsedSeconds;
    const velocityY = deltaLogicalY / elapsedSeconds;

    this.smoothedVelocityX = this.smoothedVelocityX * 0.7 + velocityX * 0.3;
    this.smoothedVelocityY = this.smoothedVelocityY * 0.75 + velocityY * 0.25;
    this.totalLogicalX = (pointerScreenX - this.startPointerX) / this.scaleFactor;
    this.totalLogicalY = (pointerScreenY - this.startPointerY) / this.scaleFactor;
    this.maximumUpwardLiftLogical = Math.max(
      this.maximumUpwardLiftLogical,
      -this.totalLogicalY
    );

    this.updateDirection(now);

    this.desiredWindowX = this.startWindowX + Math.round(
      (pointerScreenX - this.startPointerX) * this.scaleFactor
    );
    this.desiredWindowY = this.startWindowY + Math.round(
      (pointerScreenY - this.startPointerY) * this.scaleFactor
    );
    this.hasPendingPosition =
      this.desiredWindowX !== this.lastSentWindowX ||
      this.desiredWindowY !== this.lastSentWindowY;
    this.schedulePositionFlush();

    this.lastSampleX = pointerScreenX;
    this.lastSampleY = pointerScreenY;
    this.lastSampleAt = now;

    this.onProgress({
      deltaLogicalX,
      deltaLogicalY,
      totalLogicalX: this.totalLogicalX,
      totalLogicalY: this.totalLogicalY,
      totalHorizontalDistance: Math.abs(this.totalLogicalX),
      velocityX: this.smoothedVelocityX,
      velocityY: this.smoothedVelocityY,
      direction: this.direction,
      positionX: this.desiredWindowX,
      positionY: this.desiredWindowY
    });
  }

  public async end(_reason: string): Promise<ManualDragSummary> {
    if (!this.active) return this.getSummary();

    const summary = this.getSummary();
    this.active = false;
    if (this.positionFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.positionFrame);
      } else {
        clearTimeout(this.positionFrame);
      }
      this.positionFrame = null;
    }

    await this.flushPosition();
    this.ready = false;
    return summary;
  }

  public cancel(_reason: string): void {
    this.active = false;
    this.ready = false;
    if (this.positionFrame !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.positionFrame);
      } else {
        clearTimeout(this.positionFrame);
      }
      this.positionFrame = null;
    }
  }

  public isActive(): boolean {
    return this.active;
  }

  private updateDirection(now: number): void {
    const candidate = Math.abs(this.smoothedVelocityX) >= 35
      ? (this.smoothedVelocityX < 0 ? 'left' : 'right')
      : null;

    if (!candidate || candidate === this.direction) {
      this.pendingDirection = null;
      return;
    }

    if (this.direction === null) {
      this.direction = candidate;
      this.pendingDirection = null;
      return;
    }

    if (this.pendingDirection !== candidate) {
      this.pendingDirection = candidate;
      this.pendingDirectionSince = now;
      return;
    }

    if (now - this.pendingDirectionSince >= 100) {
      this.direction = candidate;
      this.pendingDirection = null;
    }
  }

  private schedulePositionFlush(): void {
    if (!this.hasPendingPosition || this.positionFrame !== null || this.positionPromise) return;

    if (typeof requestAnimationFrame === 'function') {
      this.positionFrame = requestAnimationFrame(() => {
        this.positionFrame = null;
        void this.flushPosition();
      });
    } else {
      this.positionFrame = window.setTimeout(() => {
        this.positionFrame = null;
        void this.flushPosition();
      }, 0);
    }
  }

  private async flushPosition(): Promise<void> {
    if (this.positionPromise) {
      await this.positionPromise;
      if (this.hasPendingPosition) await this.flushPosition();
      return;
    }
    if (!this.hasPendingPosition) return;

    const targetX = this.desiredWindowX;
    const targetY = this.desiredWindowY;
    this.hasPendingPosition = false;
    const appWindow = getCurrentWindow();
    this.positionPromise = appWindow.setPosition(
      new PhysicalPosition(targetX, targetY)
    ).catch((error) => {
      console.error('[manual-drag] setPosition failed:', error);
    });
    await this.positionPromise;
    this.positionPromise = null;
    this.lastSentWindowX = targetX;
    this.lastSentWindowY = targetY;
    if (this.hasPendingPosition) {
      await this.flushPosition();
    }
  }

  private getSummary(): ManualDragSummary {
    return {
      startPhysicalX: this.startWindowX,
      startPhysicalY: this.startWindowY,
      endPhysicalX: this.desiredWindowX,
      endPhysicalY: this.desiredWindowY,
      totalLogicalX: this.totalLogicalX,
      totalLogicalY: this.totalLogicalY,
      maximumUpwardLiftLogical: this.maximumUpwardLiftLogical,
      predominantlyVertical:
        Math.abs(this.totalLogicalY) > Math.abs(this.totalLogicalX) * 1.15,
      moved: Math.abs(this.totalLogicalX) > 0 || Math.abs(this.totalLogicalY) > 0
    };
  }
}
