import { HitAreaShape } from './interaction-types';

export class HitAreaEngine {
  private hitAreas: HitAreaShape[];
  private supportsHorizontalFlip: boolean;

  constructor(hitAreas: HitAreaShape[] | undefined, supportsHorizontalFlip: boolean = true) {
    if (hitAreas && hitAreas.length > 0) {
      this.hitAreas = hitAreas;
    } else {
      // Fallback for old characters
      this.hitAreas = [
        {
          id: "body",
          name: "身体",
          shape: "rect",
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          priority: 0,
          draggable: true
        }
      ];
    }
    this.supportsHorizontalFlip = supportsHorizontalFlip;
  }

  public getNormalizedCoordinates(
    clientX: number,
    clientY: number,
    spriteRect: DOMRect,
    facing: "left" | "right"
  ): { x: number; y: number } | null {
    if (spriteRect.width === 0 || spriteRect.height === 0) {
      return null;
    }

    let x = (clientX - spriteRect.left) / spriteRect.width;
    let y = (clientY - spriteRect.top) / spriteRect.height;

    // Check bounds
    if (x < 0 || x > 1 || y < 0 || y > 1 || isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
      return null;
    }

    // Handle horizontal flip
    if (facing === "left" && this.supportsHorizontalFlip) {
      x = 1 - x;
    }

    return { x, y };
  }

  // Get standardized coordinates and check hit area
  public findHitArea(
    clientX: number,
    clientY: number,
    spriteRect: DOMRect,
    facing: "left" | "right"
  ): HitAreaShape | null {
    const coords = this.getNormalizedCoordinates(clientX, clientY, spriteRect, facing);
    if (!coords) return null;

    const { x, y } = coords;

    // Sort by priority desc, then array index
    const sorted = [...this.hitAreas].sort((a, b) => {
      const priA = a.priority ?? 0;
      const priB = b.priority ?? 0;
      if (priB !== priA) {
        return priB - priA;
      }
      return this.hitAreas.indexOf(a) - this.hitAreas.indexOf(b);
    });

    for (const area of sorted) {
      if (this.isPointInArea(x, y, area)) {
        return area;
      }
    }

    return null;
  }

  public getHitAreas(): HitAreaShape[] {
    return this.hitAreas;
  }

  private isPointInArea(x: number, y: number, area: HitAreaShape): boolean {
    switch (area.shape) {
      case "rect":
        return (
          x >= area.x &&
          x <= area.x + area.width &&
          y >= area.y &&
          y <= area.y + area.height
        );
      case "ellipse": {
        const dx = x - area.cx;
        const dy = y - area.cy;
        const rx = area.rx;
        const ry = area.ry;
        if (rx === 0 || ry === 0) return false;
        return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
      }
      case "polygon": {
        if (!area.points || area.points.length < 3) return false;
        let inside = false;
        const points = area.points;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const xi = points[i][0];
          const yi = points[i][1];
          const xj = points[j][0];
          const yj = points[j][1];

          const intersect =
            yi > y !== yj > y &&
            x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
          if (intersect) inside = !inside;
        }
        return inside;
      }
      default:
        return false;
    }
  }
}
