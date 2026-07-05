export interface ScreenshotTapTarget {
  x: number;
  y: number;
  markerLeftPercent: number;
  markerTopPercent: number;
  label: string;
}

export interface RenderedImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function screenshotTapTargetFromClientPoint(image: HTMLImageElement, clientX: number, clientY: number): ScreenshotTapTarget | undefined {
  const rect = image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;

  const box = containedImageBox(rect, image.naturalWidth, image.naturalHeight);
  const xInImage = clientX - rect.left - box.left;
  const yInImage = clientY - rect.top - box.top;

  if (xInImage < 0 || yInImage < 0 || xInImage > box.width || yInImage > box.height) return undefined;

  return screenshotTapTargetFromNormalizedPoint(image, xInImage / box.width, yInImage / box.height);
}

export function screenshotTapTargetFromNormalizedPoint(image: HTMLImageElement, xValue: number, yValue: number): ScreenshotTapTarget | undefined {
  const rect = image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;

  const box = containedImageBox(rect, image.naturalWidth, image.naturalHeight);
  if (box.width <= 0 || box.height <= 0) return undefined;

  const x = clampNormalizedCoordinate(xValue);
  const y = clampNormalizedCoordinate(yValue);
  const markerLeftPercent = ((box.left + x * box.width) / rect.width) * 100;
  const markerTopPercent = ((box.top + y * box.height) / rect.height) * 100;

  return {
    x,
    y,
    markerLeftPercent,
    markerTopPercent,
    label: `x ${formatTapCoordinate(x)} y ${formatTapCoordinate(y)}`
  };
}

export function containedImageBox(rect: DOMRect, naturalWidth: number, naturalHeight: number): RenderedImageBox {
  if (rect.width <= 0 || rect.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return { left: 0, top: 0, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return {
    left: (rect.width - width) / 2,
    top: (rect.height - height) / 2,
    width,
    height
  };
}

export function clampNormalizedCoordinate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function formatTapCoordinate(value: number): string {
  return clampNormalizedCoordinate(value).toFixed(3);
}
