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
}

export interface ActiveMotion {
  type: "walk" | "fall";
  cancelled: boolean;
  lastTimestamp: number;
  currentPhysicalX: number;
  currentPhysicalY: number;
  physicalWidth: number;
  physicalHeight: number;
  fractionalX: number;
  fractionalY: number;
  velocityX: number;
  velocityY: number;
  targetDurationMs?: number;
  elapsedMs: number;
  totalLogicalDistance: number;
  onEdge?: () => void;
  onComplete?: () => void;
  onProgress?: (progress: MotionProgress) => void;
}

export class MotionController {
  private activeMotion: ActiveMotion | null = null;
  private animFrameId: number | null = null;
  private isSettingPosition: boolean = false;

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
        currentPhysicalX: currentPos.x,
        currentPhysicalY: currentPos.y,
        physicalWidth: outerSize.width,
        physicalHeight: outerSize.height,
        fractionalX: 0,
        fractionalY: 0,
        velocityX: direction === "right" ? actualSpeed : -actualSpeed,
        velocityY: 0,
        targetDurationMs: durationMs,
        elapsedMs: 0,
        totalLogicalDistance: 0,
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
        currentPhysicalX: currentPos.x,
        currentPhysicalY: currentPos.y,
        physicalWidth: outerSize.width,
        physicalHeight: outerSize.height,
        fractionalX: 0,
        fractionalY: 0,
        velocityX: 0,
        velocityY: 0,
        elapsedMs: 0,
        totalLogicalDistance: 0,
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

    let nextPhysicalX = motion.currentPhysicalX;
    let nextPhysicalY = motion.currentPhysicalY;
    let deltaLogicalX = 0;
    let deltaLogicalY = 0;
    let hitEdge = false;
    let hitFloor = false;

    if (motion.type === "walk") {
      const targetLogicalDeltaX = motion.velocityX * deltaSeconds;
      const physicalDeltaX = targetLogicalDeltaX * floorInfo.scaleFactor;
      
      motion.fractionalX += physicalDeltaX;
      const pixelsToMoveX = Math.trunc(motion.fractionalX);
      motion.fractionalX -= pixelsToMoveX;
      
      let targetX = motion.currentPhysicalX + pixelsToMoveX;
      
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
      deltaLogicalX = (nextPhysicalX - motion.currentPhysicalX) / floorInfo.scaleFactor;
    } 
    else if (motion.type === "fall") {
      motion.velocityY = Math.min(motion.velocityY + DEFAULT_GRAVITY * deltaSeconds, MAX_FALL_SPEED);
      
      const targetLogicalDeltaY = motion.velocityY * deltaSeconds;
      const physicalDeltaY = targetLogicalDeltaY * floorInfo.scaleFactor;
      
      motion.fractionalY += physicalDeltaY;
      const pixelsToMoveY = Math.trunc(motion.fractionalY);
      motion.fractionalY -= pixelsToMoveY;
      
      let targetY = motion.currentPhysicalY + pixelsToMoveY;
      
      if (targetY >= floorInfo.floorWindowY) {
        targetY = floorInfo.floorWindowY;
        hitFloor = true;
      }
      
      nextPhysicalY = targetY;
      deltaLogicalY = (nextPhysicalY - motion.currentPhysicalY) / floorInfo.scaleFactor;
    }

    if (motion.currentPhysicalX !== nextPhysicalX || motion.currentPhysicalY !== nextPhysicalY) {
      motion.currentPhysicalX = nextPhysicalX;
      motion.currentPhysicalY = nextPhysicalY;
      
      motion.totalLogicalDistance += Math.abs(deltaLogicalX);

      // 60FPS 流畅同步触发动画更新
      motion.onProgress?.({
        type: motion.type,
        deltaLogicalX,
        deltaLogicalY,
        totalLogicalDistance: motion.totalLogicalDistance,
        positionX: nextPhysicalX,
        positionY: nextPhysicalY,
      });

      // 异步不阻塞 rAF 循环分发 OS 窗口物理位移
      if (!this.isSettingPosition) {
        this.isSettingPosition = true;
        const appWindow = getCurrentWindow();
        appWindow.setPosition(new PhysicalPosition(nextPhysicalX, nextPhysicalY))
          .catch((e) => console.error("[motion] Error setPosition:", e))
          .finally(() => { this.isSettingPosition = false; });
      }
    }

    if (motion.cancelled) return;

    if (motion.type === "walk") {
      if (hitEdge) {
        if (motion.onEdge) motion.onEdge();
        return;
      }
      if (motion.targetDurationMs && motion.elapsedMs >= motion.targetDurationMs) {
        if (motion.onComplete) motion.onComplete();
        return;
      }
    } else if (motion.type === "fall") {
      if (hitFloor) {
        console.log("[motion] landed");
        if (motion.onComplete) motion.onComplete();
        return;
      }
    }

    this.animFrameId = requestAnimationFrame((n) => this.tickMotion(n, floorInfo));
  }
}
