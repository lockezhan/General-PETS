import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { FloorInfo } from './floor-controller';
import { PetSettings } from '../shared/pet-settings';

const MAX_FRAME_DELTA_SECONDS = 0.1;
const DEFAULT_GRAVITY = 1800; // logical px / s^2
const MAX_FALL_SPEED = 1400;  // logical px / s
const EDGE_PADDING = 8; // logical px

export interface MotionProgress {
  type: "walk" | "fall";
  deltaLogicalX: number;
  deltaLogicalY: number;
  totalLogicalDistance: number;
  positionX: number;
  positionY: number;
  commitCount: number;
}

export interface ActiveMotion {
  type: "walk" | "fall";
  cancelled: boolean;
  lastTimestamp: number;
  desiredPhysicalX: number;
  desiredPhysicalY: number;
  committedPhysicalX: number;
  committedPhysicalY: number;
  physicalWidth: number;
  physicalHeight: number;
  fractionalX: number;
  fractionalY: number;
  velocityX: number;
  velocityY: number;
  targetDurationMs?: number;
  elapsedMs: number;
  totalLogicalDistance: number;
  positionPromise: Promise<void> | null;
  hasPendingPosition: boolean;
  commitCount: number;
  onEdge?: () => void;
  onComplete?: () => void;
  onProgress?: (progress: MotionProgress) => void;
}

export class MotionController {
  private activeMotion: ActiveMotion | null = null;
  private animFrameId: number | null = null;

  public cancelActiveMotion(reason: string) {
    if (this.activeMotion) {
      console.log(`[motion] cancelled reason=${reason}`);
      this.activeMotion.cancelled = true;
      this.activeMotion = null;
    }
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public async startWalk(
    speed: number, 
    direction: "left" | "right", 
    durationMs: number, 
    floorInfo: FloorInfo, 
    settings: PetSettings,
    onEdge: () => void,
    onComplete: () => void,
    onProgress?: (progress: MotionProgress) => void
  ) {
    this.cancelActiveMotion("new walk started");
    
    console.log(`[motion] walk started direction=${direction}`);

    const actualSpeed = speed * settings.walkSpeedMultiplier;
    
    try {
      const appWindow = getCurrentWindow();
      const currentPos = await appWindow.outerPosition();
      const outerSize = await appWindow.outerSize();
      
      this.activeMotion = {
        type: "walk",
        cancelled: false,
        lastTimestamp: performance.now(),
        desiredPhysicalX: currentPos.x,
        desiredPhysicalY: currentPos.y,
        committedPhysicalX: currentPos.x,
        committedPhysicalY: currentPos.y,
        physicalWidth: outerSize.width,
        physicalHeight: outerSize.height,
        fractionalX: 0,
        fractionalY: 0,
        velocityX: direction === "right" ? actualSpeed : -actualSpeed,
        velocityY: 0,
        targetDurationMs: durationMs,
        elapsedMs: 0,
        totalLogicalDistance: 0,
        positionPromise: null,
        hasPendingPosition: false,
        commitCount: 0,
        onEdge,
        onComplete,
        onProgress
      };
      
      this.animFrameId = requestAnimationFrame((now) => this.tickMotion(now, floorInfo));
    } catch (e) {
      console.error("[motion] failed to start walk:", e);
    }
  }

  public async startFall(
    floorInfo: FloorInfo, 
    settings: PetSettings,
    onComplete: () => void
  ) {
    this.cancelActiveMotion("new fall started");
    
    if (!settings.gravityEnabled) {
      this.snapToFloor(floorInfo).then(onComplete);
      return;
    }

    console.log(`[motion] fall started`);

    try {
      const appWindow = getCurrentWindow();
      const currentPos = await appWindow.outerPosition();
      const outerSize = await appWindow.outerSize();
      
      this.activeMotion = {
        type: "fall",
        cancelled: false,
        lastTimestamp: performance.now(),
        desiredPhysicalX: currentPos.x,
        desiredPhysicalY: currentPos.y,
        committedPhysicalX: currentPos.x,
        committedPhysicalY: currentPos.y,
        physicalWidth: outerSize.width,
        physicalHeight: outerSize.height,
        fractionalX: 0,
        fractionalY: 0,
        velocityX: 0,
        velocityY: 0,
        elapsedMs: 0,
        totalLogicalDistance: 0,
        positionPromise: null,
        hasPendingPosition: false,
        commitCount: 0,
        onComplete
      };
      
      this.animFrameId = requestAnimationFrame((now) => this.tickMotion(now, floorInfo));
    } catch (e) {
      console.error("[motion] failed to start fall:", e);
    }
  }

  private async snapToFloor(floorInfo: FloorInfo) {
    try {
      const appWindow = getCurrentWindow();
      const pos = await appWindow.outerPosition();
      await appWindow.setPosition(new PhysicalPosition(pos.x, floorInfo.floorWindowY));
    } catch (e) {
      console.error("[motion] failed to snap to floor:", e);
    }
  }

  private tickMotion(now: number, floorInfo: FloorInfo) {
    const motion = this.activeMotion;
    if (!motion || motion.cancelled) return;

    let deltaSeconds = (now - motion.lastTimestamp) / 1000;
    if (deltaSeconds > MAX_FRAME_DELTA_SECONDS) {
      deltaSeconds = MAX_FRAME_DELTA_SECONDS;
    }
    
    motion.lastTimestamp = now;
    motion.elapsedMs += deltaSeconds * 1000;

    let nextPhysicalX = motion.desiredPhysicalX;
    let nextPhysicalY = motion.desiredPhysicalY;
    let hitEdge = false;
    let hitFloor = false;

    if (motion.type === "walk") {
      const targetLogicalDeltaX = motion.velocityX * deltaSeconds;
      const physicalDeltaX = targetLogicalDeltaX * floorInfo.scaleFactor;
      
      motion.fractionalX += physicalDeltaX;
      const pixelsToMoveX = Math.trunc(motion.fractionalX);
      motion.fractionalX -= pixelsToMoveX;
      
      let targetX = motion.desiredPhysicalX + pixelsToMoveX;
      
      const minX = floorInfo.workAreaLeft + (EDGE_PADDING * floorInfo.scaleFactor);
      const maxX = floorInfo.workAreaRight - motion.physicalWidth - (EDGE_PADDING * floorInfo.scaleFactor);
      
      if (targetX < minX) {
        targetX = minX;
        hitEdge = true;
      } else if (targetX > maxX) {
        targetX = maxX;
        hitEdge = true;
      }
      
      nextPhysicalX = targetX;
    } 
    else if (motion.type === "fall") {
      motion.velocityY = Math.min(motion.velocityY + DEFAULT_GRAVITY * deltaSeconds, MAX_FALL_SPEED);
      
      const targetLogicalDeltaY = motion.velocityY * deltaSeconds;
      const physicalDeltaY = targetLogicalDeltaY * floorInfo.scaleFactor;
      
      motion.fractionalY += physicalDeltaY;
      const pixelsToMoveY = Math.trunc(motion.fractionalY);
      motion.fractionalY -= pixelsToMoveY;
      
      let targetY = motion.desiredPhysicalY + pixelsToMoveY;
      
      if (targetY >= floorInfo.floorWindowY) {
        targetY = floorInfo.floorWindowY;
        hitFloor = true;
      }
      
      nextPhysicalY = targetY;
    }

    if (motion.desiredPhysicalX !== nextPhysicalX || motion.desiredPhysicalY !== nextPhysicalY) {
      motion.desiredPhysicalX = nextPhysicalX;
      motion.desiredPhysicalY = nextPhysicalY;
      motion.hasPendingPosition =
        nextPhysicalX !== motion.committedPhysicalX ||
        nextPhysicalY !== motion.committedPhysicalY;
    }
    if (motion.hasPendingPosition) void this.flushPosition(motion, floorInfo);

    if (motion.cancelled) return;

    if (motion.type === "walk") {
      if (hitEdge) {
        void this.finishMotionAfterFlush(motion, floorInfo, 'edge');
        return;
      }
      if (motion.targetDurationMs && motion.elapsedMs >= motion.targetDurationMs) {
        void this.finishMotionAfterFlush(motion, floorInfo, 'complete');
        return;
      }
    } else if (motion.type === "fall") {
      if (hitFloor) {
        console.log("[motion] landed");
        void this.finishMotionAfterFlush(motion, floorInfo, 'complete');
        return;
      }
    }

    this.animFrameId = requestAnimationFrame((n) => this.tickMotion(n, floorInfo));
  }

  private async flushPosition(motion: ActiveMotion, floorInfo: FloorInfo): Promise<boolean> {
    if (motion.cancelled) return false;
    if (motion.positionPromise) {
      await motion.positionPromise;
      return this.flushPosition(motion, floorInfo);
    }
    if (!motion.hasPendingPosition) return true;

    const targetX = motion.desiredPhysicalX;
    const targetY = motion.desiredPhysicalY;
    motion.hasPendingPosition = false;
    let succeeded = true;
    motion.positionPromise = getCurrentWindow().setPosition(
      new PhysicalPosition(targetX, targetY)
    ).catch((error) => {
      succeeded = false;
      console.error('[motion] Error setPosition:', error);
    });

    await motion.positionPromise;
    motion.positionPromise = null;
    if (motion.cancelled) return false;

    if (succeeded) {
      const committedDeltaX = (targetX - motion.committedPhysicalX) / floorInfo.scaleFactor;
      const committedDeltaY = (targetY - motion.committedPhysicalY) / floorInfo.scaleFactor;
      motion.committedPhysicalX = targetX;
      motion.committedPhysicalY = targetY;
      motion.totalLogicalDistance += Math.abs(committedDeltaX);
      motion.commitCount++;
      motion.onProgress?.({
        type: motion.type,
        deltaLogicalX: committedDeltaX,
        deltaLogicalY: committedDeltaY,
        totalLogicalDistance: motion.totalLogicalDistance,
        positionX: targetX,
        positionY: targetY,
        commitCount: motion.commitCount
      });
    } else {
      motion.hasPendingPosition =
        motion.desiredPhysicalX !== motion.committedPhysicalX ||
        motion.desiredPhysicalY !== motion.committedPhysicalY;
      return false;
    }

    motion.hasPendingPosition =
      motion.desiredPhysicalX !== motion.committedPhysicalX ||
      motion.desiredPhysicalY !== motion.committedPhysicalY;
    if (motion.hasPendingPosition) {
      return this.flushPosition(motion, floorInfo);
    }
    return true;
  }

  private async finishMotionAfterFlush(
    motion: ActiveMotion,
    floorInfo: FloorInfo,
    reason: 'edge' | 'complete'
  ): Promise<void> {
    if (motion.cancelled || this.activeMotion !== motion) return;
    const flushed = await this.flushPosition(motion, floorInfo);
    if (!flushed && !motion.cancelled && this.activeMotion === motion) {
      this.animFrameId = requestAnimationFrame(() => {
        void this.finishMotionAfterFlush(motion, floorInfo, reason);
      });
      return;
    }
    if (motion.cancelled || this.activeMotion !== motion) return;
    this.animFrameId = null;
    this.activeMotion = null;
    if (reason === 'edge') {
      motion.onEdge?.();
    } else {
      motion.onComplete?.();
    }
  }
}
