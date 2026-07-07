export interface ImageTransform {
  scale: number;
  x: number;
  y: number;
}

export const IDENTITY_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 };

export const MIN_LIGHTBOX_SCALE = 1;
export const MAX_LIGHTBOX_SCALE = 8;

/**
 * Zooms by `factor` while keeping the container-space anchor point visually
 * stationary: the content position under the cursor stays under the cursor.
 */
export function zoomAt(
  current: ImageTransform,
  anchorX: number,
  anchorY: number,
  factor: number,
  minScale = MIN_LIGHTBOX_SCALE,
  maxScale = MAX_LIGHTBOX_SCALE
): ImageTransform {
  const nextScale = clamp(current.scale * factor, minScale, maxScale);
  if (nextScale === current.scale) return current;

  const ratio = nextScale / current.scale;
  return {
    scale: nextScale,
    x: anchorX - (anchorX - current.x) * ratio,
    y: anchorY - (anchorY - current.y) * ratio
  };
}

export function panBy(current: ImageTransform, deltaX: number, deltaY: number): ImageTransform {
  if (deltaX === 0 && deltaY === 0) return current;
  return { ...current, x: current.x + deltaX, y: current.y + deltaY };
}

/** Maps a container point into content (unscaled image) coordinates. */
export function containerPointToContent(current: ImageTransform, pointX: number, pointY: number): { x: number; y: number } {
  return {
    x: (pointX - current.x) / current.scale,
    y: (pointY - current.y) / current.scale
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
