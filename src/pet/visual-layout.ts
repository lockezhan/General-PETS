export interface PetVisualLayout {
  stageWidth: number;
  stageHeight: number;
  windowWidth: number;
  windowHeight: number;
}

const HORIZONTAL_PADDING = 16;
const TOP_BUBBLE_RESERVE = 64;
const BOTTOM_PADDING = 8;

export function calculatePetVisualLayout(
  frameWidth: number,
  frameHeight: number,
  scale: number
): PetVisualLayout {
  const stageWidth = Math.round(frameWidth * scale);
  const stageHeight = Math.round(frameHeight * scale);

  return {
    stageWidth,
    stageHeight,
    windowWidth: stageWidth + HORIZONTAL_PADDING * 2,
    windowHeight: stageHeight + TOP_BUBBLE_RESERVE + BOTTOM_PADDING
  };
}
