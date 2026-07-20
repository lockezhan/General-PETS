export type PetFacing = "left" | "right";

export class FacingController {
  private layerElement: HTMLElement;
  private currentFacing: PetFacing = "right";
  private mirrorEnabled = true;

  constructor(layerElement: HTMLElement) {
    this.layerElement = layerElement;
    this.applyFacing();
  }

  /**
   * @param facing 逻辑朝向（总是更新）
   * @param supportsHorizontalFlip 是否允许 CSS 镜像。
   *   false 时：逻辑朝向更新，但 CSS 不翻转（Codex 已有独立左右行）。
   *   true  时：逻辑朝向更新，且 CSS 翻转（普通内置角色）。
   */
  public setFacing(facing: PetFacing, supportsHorizontalFlip: boolean = true) {
    this.currentFacing = facing;
    this.mirrorEnabled = supportsHorizontalFlip;
    this.applyFacing();
  }

  public getFacing(): PetFacing {
    return this.currentFacing;
  }

  private applyFacing() {
    // 逻辑朝向（调试 / HitArea 坐标系使用）
    this.layerElement.dataset.logicalFacing = this.currentFacing;

    // CSS 朝向（驱动 CSS scaleX(-1)）
    // mirrorEnabled=false 时固定为 right，外层不镜像
    this.layerElement.dataset.facing = this.mirrorEnabled
      ? this.currentFacing
      : "right";
  }
}
