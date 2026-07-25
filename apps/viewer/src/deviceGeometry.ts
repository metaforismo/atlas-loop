/**
 * Device geometry derived from published iPhone hardware specifications.
 *
 * The frame is drawn from a real spec instead of eyeballed pixels so it stays
 * correct at every rendered size. Every visual value is expressed as a
 * percentage of the body box, which keeps the bezel, corner radii, Dynamic
 * Island, and side controls proportional whether the frame is a 250px landing
 * preview or a 405px live viewport.
 */

const MM_PER_INCH = 25.4;

export type ControlSide = "left" | "right";

export interface DeviceControlSpec {
  /** Stable identifier used for the control's class name. */
  id: string;
  side: ControlSide;
  /** Distance from the top of the body to the top of the control, in millimetres. */
  topMm: number;
  /** Control length along the body edge, in millimetres. */
  lengthMm: number;
  /** How far the control stands proud of the rail, in millimetres. */
  protrusionMm: number;
}

export interface DeviceSpec {
  id: string;
  name: string;
  /** Logical screen size in points. */
  screenWidthPt: number;
  screenHeightPt: number;
  /** Backing-store scale factor (3 on Pro-class hardware). */
  screenScale: number;
  /** Display density in pixels per inch. */
  pixelsPerInch: number;
  /** Published body size in millimetres, used to derive the bezel. */
  bodyWidthMm: number;
  bodyHeightMm: number;
  /** Display corner radius in points. */
  screenCornerRadiusPt: number;
  /** Dynamic Island size and offset in points. */
  islandWidthPt: number;
  islandHeightPt: number;
  islandTopPt: number;
  /** Home indicator size and offset in points. */
  homeIndicatorWidthPt: number;
  homeIndicatorHeightPt: number;
  homeIndicatorBottomPt: number;
  /** Antenna band inset from the nearest body end, in millimetres. */
  antennaInsetMm: number;
  controls: DeviceControlSpec[];
}

/**
 * iPhone 16 Pro. Screen 6.3" at 460 ppi (1206 x 2622 px, 402 x 874 pt),
 * body 71.5 x 149.6 x 8.25 mm.
 */
export const IPHONE_16_PRO: DeviceSpec = {
  id: "iphone-16-pro",
  name: "iPhone 16 Pro",
  screenWidthPt: 402,
  screenHeightPt: 874,
  screenScale: 3,
  pixelsPerInch: 460,
  bodyWidthMm: 71.5,
  bodyHeightMm: 149.6,
  screenCornerRadiusPt: 62,
  islandWidthPt: 125,
  islandHeightPt: 36.67,
  islandTopPt: 11,
  homeIndicatorWidthPt: 139,
  homeIndicatorHeightPt: 5,
  homeIndicatorBottomPt: 8,
  antennaInsetMm: 26.5,
  controls: [
    { id: "action", side: "left", topMm: 32.6, lengthMm: 8.6, protrusionMm: 0.35 },
    { id: "volume-up", side: "left", topMm: 45.4, lengthMm: 14.2, protrusionMm: 0.35 },
    { id: "volume-down", side: "left", topMm: 62.9, lengthMm: 14.2, protrusionMm: 0.35 },
    { id: "power", side: "right", topMm: 44.9, lengthMm: 24.4, protrusionMm: 0.35 },
    { id: "camera-control", side: "right", topMm: 87.9, lengthMm: 12.8, protrusionMm: 0.2 }
  ]
};

export interface DeviceControlGeometry {
  id: string;
  side: ControlSide;
  /** Percentage of body height. */
  topPercent: number;
  heightPercent: number;
  /** Percentage of body width. */
  widthPercent: number;
}

export interface DeviceGeometry {
  id: string;
  name: string;
  /** Physical screen size in millimetres, derived from pixels and density. */
  screenWidthMm: number;
  screenHeightMm: number;
  /** Uniform bezel width in millimetres. */
  bezelMm: number;
  /**
   * Body size in millimetres, derived as screen + 2 x bezel so the rendered
   * frame is internally consistent rather than only close to the spec.
   */
  bodyWidthMm: number;
  bodyHeightMm: number;
  /** Body width divided by body height, for `aspect-ratio`. */
  aspectRatio: number;
  /** Bezel as a percentage of body width (CSS percentage padding uses width). */
  bezelPercent: number;
  /** Corner radii, as separate horizontal/vertical percentages of the body box. */
  bodyRadiusXPercent: number;
  bodyRadiusYPercent: number;
  /** Corner radii as percentages of the screen box. */
  screenRadiusXPercent: number;
  screenRadiusYPercent: number;
  /** Dynamic Island, as percentages of the screen box. */
  islandWidthPercent: number;
  islandHeightPercent: number;
  islandTopPercent: number;
  /** Home indicator, as percentages of the screen box. */
  homeIndicatorWidthPercent: number;
  homeIndicatorHeightPercent: number;
  homeIndicatorBottomPercent: number;
  /** Antenna band inset as a percentage of body height. */
  antennaInsetPercent: number;
  controls: DeviceControlGeometry[];
}

function millimetresFromPixels(pixels: number, pixelsPerInch: number): number {
  return (pixels / pixelsPerInch) * MM_PER_INCH;
}

/**
 * Derives every proportional value the frame needs from a hardware spec.
 *
 * The bezel is the mean of the horizontal and vertical gap between the
 * published body size and the physical screen size. Real hardware has a
 * uniform bezel, so averaging the two measurements is closer to the device
 * than trusting either axis alone.
 */
export function deviceGeometry(spec: DeviceSpec): DeviceGeometry {
  const screenWidthMm = millimetresFromPixels(spec.screenWidthPt * spec.screenScale, spec.pixelsPerInch);
  const screenHeightMm = millimetresFromPixels(spec.screenHeightPt * spec.screenScale, spec.pixelsPerInch);
  const bezelMm = ((spec.bodyWidthMm - screenWidthMm) / 2 + (spec.bodyHeightMm - screenHeightMm) / 2) / 2;
  const bodyWidthMm = screenWidthMm + bezelMm * 2;
  const bodyHeightMm = screenHeightMm + bezelMm * 2;
  const millimetresPerPoint = screenWidthMm / spec.screenWidthPt;
  const screenRadiusMm = spec.screenCornerRadiusPt * millimetresPerPoint;
  const bodyRadiusMm = screenRadiusMm + bezelMm;

  return {
    id: spec.id,
    name: spec.name,
    screenWidthMm,
    screenHeightMm,
    bezelMm,
    bodyWidthMm,
    bodyHeightMm,
    aspectRatio: bodyWidthMm / bodyHeightMm,
    bezelPercent: (bezelMm / bodyWidthMm) * 100,
    bodyRadiusXPercent: (bodyRadiusMm / bodyWidthMm) * 100,
    bodyRadiusYPercent: (bodyRadiusMm / bodyHeightMm) * 100,
    screenRadiusXPercent: (screenRadiusMm / screenWidthMm) * 100,
    screenRadiusYPercent: (screenRadiusMm / screenHeightMm) * 100,
    islandWidthPercent: (spec.islandWidthPt / spec.screenWidthPt) * 100,
    islandHeightPercent: (spec.islandHeightPt / spec.screenHeightPt) * 100,
    islandTopPercent: (spec.islandTopPt / spec.screenHeightPt) * 100,
    homeIndicatorWidthPercent: (spec.homeIndicatorWidthPt / spec.screenWidthPt) * 100,
    homeIndicatorHeightPercent: (spec.homeIndicatorHeightPt / spec.screenHeightPt) * 100,
    homeIndicatorBottomPercent: (spec.homeIndicatorBottomPt / spec.screenHeightPt) * 100,
    antennaInsetPercent: (spec.antennaInsetMm / bodyHeightMm) * 100,
    controls: spec.controls.map((control) => ({
      id: control.id,
      side: control.side,
      topPercent: (control.topMm / bodyHeightMm) * 100,
      heightPercent: (control.lengthMm / bodyHeightMm) * 100,
      widthPercent: (control.protrusionMm / bodyWidthMm) * 100
    }))
  };
}

function percent(value: number): string {
  return `${value.toFixed(4)}%`;
}

/**
 * Renders the geometry as CSS custom properties. Percentages keep the frame
 * proportional at any rendered width without container queries.
 */
export function deviceFrameStyle(geometry: DeviceGeometry): Record<string, string> {
  return {
    "--ios-aspect": geometry.aspectRatio.toFixed(6),
    "--ios-bezel": percent(geometry.bezelPercent),
    "--ios-body-radius": `${percent(geometry.bodyRadiusXPercent)} / ${percent(geometry.bodyRadiusYPercent)}`,
    "--ios-screen-radius": `${percent(geometry.screenRadiusXPercent)} / ${percent(geometry.screenRadiusYPercent)}`,
    "--ios-island-width": percent(geometry.islandWidthPercent),
    "--ios-island-height": percent(geometry.islandHeightPercent),
    "--ios-island-top": percent(geometry.islandTopPercent),
    "--ios-home-width": percent(geometry.homeIndicatorWidthPercent),
    "--ios-home-height": percent(geometry.homeIndicatorHeightPercent),
    "--ios-home-bottom": percent(geometry.homeIndicatorBottomPercent),
    "--ios-antenna-inset": percent(geometry.antennaInsetPercent)
  };
}

export function deviceControlStyle(control: DeviceControlGeometry): Record<string, string> {
  return {
    top: percent(control.topPercent),
    height: percent(control.heightPercent),
    width: percent(control.widthPercent)
  };
}

export const IPHONE_16_PRO_GEOMETRY = deviceGeometry(IPHONE_16_PRO);
