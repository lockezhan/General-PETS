import { currentMonitor, primaryMonitor, getCurrentWindow } from '@tauri-apps/api/window';

export interface FloorInfo {
  monitorName: string | null;
  scaleFactor: number;
  workAreaLeft: number;
  workAreaTop: number;
  workAreaRight: number;
  workAreaBottom: number;
  floorWindowY: number;
}

export class FloorController {
  private cachedFloorInfo: FloorInfo | null = null;
  
  public async getCurrentFloorInfo(bottomPaddingLogical: number = 8): Promise<FloorInfo | null> {
    if (this.cachedFloorInfo) {
      return this.cachedFloorInfo;
    }

    try {
      const appWindow = getCurrentWindow();
      const monitor = await currentMonitor() || await primaryMonitor();
      
      if (!monitor) {
        console.warn("[FloorController] Cannot find any monitor.");
        return null;
      }
      
      const workArea = monitor.workArea;
      const windowOuterSize = await appWindow.outerSize();
      const scaleFactor = monitor.scaleFactor;
      
      const bottomMarginPhysical = Math.round(bottomPaddingLogical * scaleFactor);
      
      const floorWindowY = workArea.position.y + workArea.size.height - windowOuterSize.height - bottomMarginPhysical;
      
      this.cachedFloorInfo = {
        monitorName: monitor.name,
        scaleFactor,
        workAreaLeft: workArea.position.x,
        workAreaTop: workArea.position.y,
        workAreaRight: workArea.position.x + workArea.size.width,
        workAreaBottom: workArea.position.y + workArea.size.height,
        floorWindowY
      };

      console.log("[FloorController] FloorInfo cache created:", this.cachedFloorInfo);
      return this.cachedFloorInfo;
    } catch (e) {
      console.error("[FloorController] Error calculating floor:", e);
      return null;
    }
  }

  public invalidateCache() {
    console.log("[FloorController] Invaliding FloorInfo cache");
    this.cachedFloorInfo = null;
  }
}
