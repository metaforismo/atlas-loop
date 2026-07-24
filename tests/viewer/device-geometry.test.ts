import { describe, expect, it } from "vitest";
import {
  IPHONE_16_PRO,
  IPHONE_16_PRO_GEOMETRY,
  deviceControlStyle,
  deviceFrameStyle,
  deviceGeometry
} from "../../apps/viewer/src/deviceGeometry.js";

describe("device geometry", () => {
  it("derives the physical screen size from the published pixel count and density", () => {
    const geometry = deviceGeometry(IPHONE_16_PRO);

    // 1206 x 2622 px at 460 ppi is a 66.59 x 144.78 mm panel.
    expect(geometry.screenWidthMm).toBeCloseTo(66.59, 2);
    expect(geometry.screenHeightMm).toBeCloseTo(144.78, 2);
  });

  it("reconstructs the published body size from the screen plus a uniform bezel", () => {
    const geometry = deviceGeometry(IPHONE_16_PRO);

    // A real iPhone has one bezel width on every edge, so the reconstructed
    // body must land on the published 71.5 x 149.6 mm within a tenth of a
    // millimetre rather than matching only one axis.
    expect(geometry.bodyWidthMm).toBeCloseTo(IPHONE_16_PRO.bodyWidthMm, 1);
    expect(geometry.bodyHeightMm).toBeCloseTo(IPHONE_16_PRO.bodyHeightMm, 1);
    expect(geometry.bezelMm).toBeCloseTo(2.43, 2);
  });

  it("keeps the corner radii concentric so the bezel stays an even ring", () => {
    const geometry = deviceGeometry(IPHONE_16_PRO);
    const bodyRadiusMm = (geometry.bodyRadiusXPercent / 100) * geometry.bodyWidthMm;
    const screenRadiusMm = (geometry.screenRadiusXPercent / 100) * geometry.screenWidthMm;

    expect(bodyRadiusMm - screenRadiusMm).toBeCloseTo(geometry.bezelMm, 5);
  });

  it("expresses the horizontal and vertical radii as different percentages of the same corner", () => {
    const geometry = deviceGeometry(IPHONE_16_PRO);

    // The body box is far taller than it is wide, so a single percentage would
    // render an ellipse instead of a circular corner.
    expect(geometry.bodyRadiusYPercent).toBeLessThan(geometry.bodyRadiusXPercent);
    expect(geometry.bodyRadiusXPercent / geometry.bodyRadiusYPercent).toBeCloseTo(
      geometry.bodyHeightMm / geometry.bodyWidthMm,
      5
    );
  });

  it("places the Dynamic Island and home indicator from point measurements", () => {
    const geometry = deviceGeometry(IPHONE_16_PRO);

    expect(geometry.islandWidthPercent).toBeCloseTo((125 / 402) * 100, 5);
    expect(geometry.islandTopPercent).toBeCloseTo((11 / 874) * 100, 5);
    expect(geometry.homeIndicatorWidthPercent).toBeCloseTo((139 / 402) * 100, 5);
  });

  it("orders the side controls the way the hardware does", () => {
    const geometry = deviceGeometry(IPHONE_16_PRO);
    const byId = new Map(geometry.controls.map((control) => [control.id, control]));

    expect(byId.get("action")!.side).toBe("left");
    expect(byId.get("camera-control")!.side).toBe("right");
    // Action button, then volume up, then volume down, top to bottom.
    expect(byId.get("action")!.topPercent).toBeLessThan(byId.get("volume-up")!.topPercent);
    expect(byId.get("volume-up")!.topPercent).toBeLessThan(byId.get("volume-down")!.topPercent);
    // Every control sits inside the body.
    for (const control of geometry.controls) {
      expect(control.topPercent).toBeGreaterThan(0);
      expect(control.topPercent + control.heightPercent).toBeLessThan(100);
    }
  });

  it("emits percentage custom properties so one frame scales to any width", () => {
    const style = deviceFrameStyle(IPHONE_16_PRO_GEOMETRY);

    expect(style["--ios-aspect"]).toBe(IPHONE_16_PRO_GEOMETRY.aspectRatio.toFixed(6));
    expect(style["--ios-bezel"]).toMatch(/^\d+\.\d+%$/);
    expect(style["--ios-body-radius"]).toMatch(/^\d+\.\d+% \/ \d+\.\d+%$/);
    expect(style["--ios-screen-radius"]).toMatch(/^\d+\.\d+% \/ \d+\.\d+%$/);
    expect(Object.values(style).every((value) => !value.includes("px"))).toBe(true);
  });

  it("positions a control entirely in percentages", () => {
    const control = IPHONE_16_PRO_GEOMETRY.controls[0]!;

    expect(deviceControlStyle(control)).toEqual({
      top: expect.stringMatching(/%$/),
      height: expect.stringMatching(/%$/),
      width: expect.stringMatching(/%$/)
    });
  });
});
