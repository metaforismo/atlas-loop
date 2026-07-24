import type { ReactNode } from "react";

type DeviceStatus = "online" | "offline" | "idle";
type DeviceVariant = "hero" | "viewer";

export function IOSDeviceFrame({
  children,
  label,
  meta,
  status = "idle",
  variant = "viewer"
}: {
  children: ReactNode;
  label: string;
  meta?: string;
  status?: DeviceStatus;
  variant?: DeviceVariant;
}) {
  return (
    <div className={`ios-device ios-device-${variant}`} role="group" aria-label={label}>
      {meta ? (
        <div className="ios-device-meta" aria-label={`Device status: ${status}`}>
          <span className={`ios-device-signal tone-${status}`}><i aria-hidden="true" />{status}</span>
          <small title={meta}>{meta}</small>
        </div>
      ) : null}
      <div className="ios-device-hardware">
        <span className="ios-device-antenna ios-device-antenna-top-left" aria-hidden="true" />
        <span className="ios-device-antenna ios-device-antenna-top-right" aria-hidden="true" />
        <span className="ios-device-antenna ios-device-antenna-bottom-left" aria-hidden="true" />
        <span className="ios-device-antenna ios-device-antenna-bottom-right" aria-hidden="true" />
        <span className="ios-device-button ios-device-button-action" aria-hidden="true" />
        <span className="ios-device-button ios-device-button-volume-up" aria-hidden="true" />
        <span className="ios-device-button ios-device-button-volume-down" aria-hidden="true" />
        <span className="ios-device-button ios-device-button-power" aria-hidden="true" />
        <span className="ios-device-button ios-device-button-camera" aria-hidden="true" />
        <div className="ios-device-rim">
          <div className="ios-device-screen">
            {children}
            <span className="ios-device-island" aria-hidden="true"><b /><i /></span>
            <span className="ios-device-home-indicator" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
