import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { IDENTITY_TRANSFORM, panBy, zoomAt, type ImageTransform } from "../imageTransform.js";
import { useModalDialog } from "../useModalDialog.js";

export function ImageLightbox({
  src,
  alt,
  caption,
  onClose
}: {
  src: string;
  alt: string;
  caption?: string;
  onClose: () => void;
}) {
  const [transform, setTransform] = useState<ImageTransform>(IDENTITY_TRANSFORM);
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | undefined>(undefined);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { dialogRef, initialFocusRef } = useModalDialog(onClose);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const bounds = frameRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const factor = event.deltaY > 0 ? 0.88 : 1.14;
    setTransform((current) => zoomAt(current, event.clientX - bounds.left, event.clientY - bounds.top, factor));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    setTransform((current) => panBy(current, deltaX, deltaY));
  };

  const handlePointerUp = (): void => {
    dragRef.current = undefined;
  };

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="lightbox-panel" role="dialog" aria-modal="true" aria-label={`Zoomed view of ${alt}`} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="lightbox-toolbar">
          <span className="lightbox-caption" title={caption ?? alt}>
            {caption ?? alt}
          </span>
          <span className="lightbox-scale">{Math.round(transform.scale * 100)}%</span>
          <button type="button" onClick={() => setTransform(IDENTITY_TRANSFORM)}>
            Reset
          </button>
          <button ref={initialFocusRef} type="button" aria-label="Close zoomed view" onClick={onClose}>
            ✕
          </button>
        </div>
        <div
          ref={frameRef}
          className="lightbox-frame"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onDoubleClick={() => setTransform(IDENTITY_TRANSFORM)}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
          />
        </div>
      </div>
    </div>
  );
}
