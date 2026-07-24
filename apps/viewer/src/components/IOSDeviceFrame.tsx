import type { CSSProperties, ReactNode } from "react";
import {
  IPHONE_16_PRO_GEOMETRY,
  deviceControlStyle,
  deviceFrameStyle,
  type DeviceGeometry
} from "../deviceGeometry.js";

type DeviceStatus = "online" | "offline" | "idle";
type DeviceVariant = "hero" | "viewer";

export function IOSDeviceFrame({
  children,
  label,
  meta,
  status = "idle",
  variant = "viewer",
  geometry = IPHONE_16_PRO_GEOMETRY
}: {
  children: ReactNode;
  label: string;
  meta?: string;
  status?: DeviceStatus;
  variant?: DeviceVariant;
  geometry?: DeviceGeometry;
}) {
  return (
    <div
      className={`ios-device ios-device-${variant}`}
      role="group"
      aria-label={label}
      data-device={geometry.id}
      style={deviceFrameStyle(geometry) as CSSProperties}
    >
      {meta ? (
        <div className="ios-device-meta" aria-label={`Device status: ${status}`}>
          <span className={`ios-device-signal tone-${status}`}><i aria-hidden="true" />{status}</span>
          <small title={meta}>{meta}</small>
        </div>
      ) : null}
      <div className="ios-device-hardware">
        {geometry.controls.map((control) => (
          <span
            key={control.id}
            className={`ios-device-button ios-device-button-${control.id} ios-device-button-${control.side}`}
            style={deviceControlStyle(control) as CSSProperties}
            aria-hidden="true"
          />
        ))}
        <span className="ios-device-antenna ios-device-antenna-top-left" aria-hidden="true" />
        <span className="ios-device-antenna ios-device-antenna-top-right" aria-hidden="true" />
        <span className="ios-device-antenna ios-device-antenna-bottom-left" aria-hidden="true" />
        <span className="ios-device-antenna ios-device-antenna-bottom-right" aria-hidden="true" />
        <div className="ios-device-rim">
          <div className="ios-device-screen">
            {children}
            <span className="ios-device-island" aria-hidden="true"><b /><i /></span>
            <span className="ios-device-home-indicator" aria-hidden="true" />
          </div>
        </div>
        <span className="ios-device-gloss" aria-hidden="true" />
      </div>
    </div>
  );
}
