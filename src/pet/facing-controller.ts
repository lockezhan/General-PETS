export type PetFacing = "left" | "right";

export class FacingController {
  private layerElement: HTMLElement;
  private currentFacing: PetFacing = "right";

  constructor(layerElement: HTMLElement) {
    this.layerElement = layerElement;
    this.applyFacing();
  }

  public setFacing(facing: PetFacing, supportsHorizontalFlip: boolean = true) {
    if (!supportsHorizontalFlip) return;
    this.currentFacing = facing;
    this.applyFacing();
  }

  public getFacing(): PetFacing {
    return this.currentFacing;
  }

  private applyFacing() {
    this.layerElement.dataset.facing = this.currentFacing;
  }
}
