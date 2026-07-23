import { useEffect, useRef, useState } from "react";
import { DEFAULT_DIFF_THRESHOLD, diffPixels, padPixels } from "../imageDiff.js";
import { useModalDialog } from "../useModalDialog.js";

interface LoadedImage {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

type CompareState =
  | { status: "loading" }
  | { status: "ready"; changedRatio: number; changedCount: number }
  | { status: "error"; message: string };

export function CompareView({
  beforeUrl,
  afterUrl,
  beforeLabel,
  afterLabel,
  onClose
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel: string;
  afterLabel: string;
  onClose: () => void;
}) {
  const [threshold, setThreshold] = useState(DEFAULT_DIFF_THRESHOLD);
  const [state, setState] = useState<CompareState>({ status: "loading" });
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<{ before: LoadedImage; after: LoadedImage } | undefined>(undefined);
  const { dialogRef, initialFocusRef } = useModalDialog(onClose);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    imagesRef.current = undefined;

    Promise.all([loadImagePixels(beforeUrl), loadImagePixels(afterUrl)])
      .then(([before, after]) => {
        if (cancelled) return;
        imagesRef.current = { before, after };
        setState({ status: "ready", changedRatio: 0, changedCount: 0 });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "Could not load screenshots for diffing." });
      });

    return () => {
      cancelled = true;
    };
  }, [beforeUrl, afterUrl]);

  useEffect(() => {
    const images = imagesRef.current;
    const canvas = overlayRef.current;
    if (!images || !canvas || state.status === "loading" || state.status === "error") return;

    const width = Math.max(images.before.width, images.after.width);
    const height = Math.max(images.before.height, images.after.height);
    const before = padPixels(images.before.pixels, images.before.width, images.before.height, width, height);
    const after = padPixels(images.after.pixels, images.after.width, images.after.height, width, height);
    const result = diffPixels(before, after, width, height, threshold);

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const base = context.createImageData(width, height);
    base.data.set(after);
    context.putImageData(base, 0, 0);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskContext = maskCanvas.getContext("2d");
    if (maskContext) {
      const maskData = maskContext.createImageData(width, height);
      maskData.data.set(result.mask);
      maskContext.putImageData(maskData, 0, 0);
      context.drawImage(maskCanvas, 0, 0);
    }

    setState((current) =>
      current.status === "ready" && (current.changedRatio !== result.changedRatio || current.changedCount !== result.changedCount)
        ? { status: "ready", changedRatio: result.changedRatio, changedCount: result.changedCount }
        : current
    );
  }, [state.status, threshold]);

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="lightbox-panel compare-panel" role="dialog" aria-modal="true" aria-label="Screenshot comparison" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="lightbox-toolbar">
          <span className="lightbox-caption">
            {state.status === "ready"
              ? `${(state.changedRatio * 100).toFixed(2)}% changed (${state.changedCount.toLocaleString()} px)`
              : state.status === "loading"
                ? "Loading screenshots..."
                : "Diff unavailable"}
          </span>
          <label className="compare-threshold">
            Threshold {threshold}
            <input
              type="range"
              min={0}
              max={80}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
              aria-label="Pixel difference threshold"
            />
          </label>
          <button ref={initialFocusRef} type="button" aria-label="Close comparison" onClick={onClose}>
            ✕
          </button>
        </div>

        {state.status === "error" ? (
          <p className="inline-error" role="alert">
            {state.message}
          </p>
        ) : null}

        <div className="compare-grid">
          <figure>
            <figcaption>{beforeLabel}</figcaption>
            <img src={beforeUrl} alt={beforeLabel} crossOrigin="anonymous" />
          </figure>
          <figure>
            <figcaption>{afterLabel}</figcaption>
            <img src={afterUrl} alt={afterLabel} crossOrigin="anonymous" />
          </figure>
          <figure>
            <figcaption>Changes</figcaption>
            <canvas ref={overlayRef} aria-label="Difference overlay" />
          </figure>
        </div>
      </div>
    </div>
  );
}

async function loadImagePixels(url: string): Promise<LoadedImage> {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("canvas 2d context is unavailable in this browser");
  }
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: data.data, width: canvas.width, height: canvas.height };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load image: ${url}`));
    image.src = url;
  });
}
