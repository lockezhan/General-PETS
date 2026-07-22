export const MIN_INTERACTIVE_ALPHA = 24;

export function isCanvasPointOpaque(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  visualRect: DOMRect,
  minimumAlpha: number = MIN_INTERACTIVE_ALPHA,
): boolean {
  if (
    visualRect.width <= 0 || visualRect.height <= 0 ||
    canvas.width <= 0 || canvas.height <= 0 ||
    clientX < visualRect.left || clientX > visualRect.right ||
    clientY < visualRect.top || clientY > visualRect.bottom
  ) {
    return false;
  }

  const normalizedX = (clientX - visualRect.left) / visualRect.width;
  const normalizedY = (clientY - visualRect.top) / visualRect.height;
  const pixelX = Math.min(canvas.width - 1, Math.max(0, Math.floor(normalizedX * canvas.width)));
  const pixelY = Math.min(canvas.height - 1, Math.max(0, Math.floor(normalizedY * canvas.height)));

  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return true;
    return context.getImageData(pixelX, pixelY, 1, 1).data[3] >= minimumAlpha;
  } catch (error) {
    console.warn('[interaction] alpha hit-test unavailable; falling back to configured hit areas', error);
    return true;
  }
}
