import { useRef } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { isDisplayableScreenshot } from "../api.js";
import {
  screenshotTapTargetFromClientPoint,
  screenshotTapTargetFromNormalizedPoint,
  type ScreenshotTapTarget
} from "../screenshotGeometry.js";
import type { ScreenshotState } from "../types.js";

type ScreenshotTargetStyle = CSSProperties & {
  "--target-left": string;
  "--target-top": string;
};

export function ScreenshotView({
  screenshot,
  emptyMessage,
  emptyAction,
  tapTarget,
  onTapTarget
}: {
  screenshot: ScreenshotState;
  emptyMessage?: string;
  emptyAction?: { label: string; onSelect: () => void };
  tapTarget?: ScreenshotTapTarget;
  onTapTarget: (target: ScreenshotTapTarget) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const image = imageRef.current;
    if (!image) return;

    const target = screenshotTapTargetFromClientPoint(image, event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    onTapTarget(target);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const image = imageRef.current;
    if (!image) return;

    const target = screenshotTapTargetFromNormalizedPoint(image, 0.5, 0.5);
    if (!target) return;
    event.preventDefault();
    onTapTarget(target);
  };

  if (isDisplayableScreenshot(screenshot)) {
    const targetStyle = tapTarget
      ? ({
          "--target-left": `${tapTarget.markerLeftPercent}%`,
          "--target-top": `${tapTarget.markerTopPercent}%`
        } as ScreenshotTargetStyle)
      : undefined;

    return (
      <button
        type="button"
        className={`screenshot-image-wrap ${screenshot.status}`}
        aria-label="Select normalized tap target from screenshot; press Enter for center"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <img
          ref={imageRef}
          className="screenshot-image"
          src={screenshot.src}
          alt={screenshot.status === "stale" ? "Stale iOS Simulator screenshot" : "Latest iOS Simulator screenshot"}
          draggable={false}
        />
        {tapTarget ? (
          <>
            <span className="screenshot-target-readout" role="status" aria-live="polite" aria-atomic="true">
              {tapTarget.label}
            </span>
            <span className="screenshot-target-marker" style={targetStyle} aria-hidden="true" />
          </>
        ) : null}
        {screenshot.status === "stale" ? (
          <span className="screenshot-stale-banner" role="status" aria-live="polite" aria-atomic="true">
            <strong>Stale image</strong>
            <span>{`Refresh failed: ${screenshot.message}`}</span>
          </span>
        ) : null}
      </button>
    );
  }

  const message =
    screenshot.status === "loading"
      ? "Loading latest screenshot..."
      : screenshot.status === "empty"
        ? (emptyMessage ?? screenshot.message)
        : (emptyMessage ?? `Screenshot unavailable: ${screenshot.message}`);

  return (
    <div className={`screenshot-placeholder ${screenshot.status}`}>
      {screenshot.status === "loading" ? (
        <div className="screenshot-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      <span role="status" aria-live="polite" aria-atomic="true">{message}</span>
      {screenshot.status !== "loading" && emptyAction ? (
        <button type="button" className="screenshot-empty-action" onClick={emptyAction.onSelect}>
          {emptyAction.label}
        </button>
      ) : null}
    </div>
  );
}
