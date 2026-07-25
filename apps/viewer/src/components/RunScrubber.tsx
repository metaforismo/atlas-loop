import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { advanceFraction, formatElapsed, resolveRunMoment, stepFraction, type RunScrubberModel } from "../runScrubber.js";

const SPEEDS = [1, 2, 4, 8] as const;
const TICK_MS = 100;

/**
 * The run's playhead. Dragging it moves the device screenshot, the highlighted
 * step, and the metrics cursor together, so "what was on screen when this
 * happened" is one gesture rather than three panels and some arithmetic.
 */
export function RunScrubber({
  model,
  fraction,
  scrubbing,
  onScrub,
  onExit
}: {
  model: RunScrubberModel;
  fraction: number;
  /** False while the workspace is following the run rather than replaying it. */
  scrubbing: boolean;
  onScrub: (fraction: number) => void;
  /** Leaves replay and returns the workspace to live state. */
  onExit: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const moment = resolveRunMoment(model, fraction);

  // Held in refs so the playback timer survives re-renders. Depending on the
  // position or the caller's handler would tear the interval down on every
  // frame, and playback would crawl instead of running at the chosen speed.
  const fractionRef = useRef(fraction);
  fractionRef.current = fraction;
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    if (!playing) return;
    const startedWall = performance.now();
    const startedFraction = fractionRef.current;
    const timer = window.setInterval(() => {
      onScrubRef.current(
        advanceFraction(modelRef.current, startedFraction, performance.now() - startedWall, speed)
      );
    }, TICK_MS);
    return () => window.clearInterval(timer);
    // Keyed on the duration, not the model: a run that grows while playing gets
    // a fresh model object every render, and depending on it would restart the
    // clock each time and stall playback.
  }, [playing, speed, model.durationMs]);

  // Playing past the end stops rather than looping; a run happened once.
  useEffect(() => {
    if (playing && fraction >= 1) setPlaying(false);
  }, [playing, fraction]);

  const scrubToClientX = (clientX: number): void => {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return;
    onScrub((clientX - bounds.left) / bounds.width);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubToClientX(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    scrubToClientX(event.clientX);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, () => number> = {
      ArrowRight: () => stepFraction(model, fraction, 1),
      ArrowLeft: () => stepFraction(model, fraction, -1),
      Home: () => 0,
      End: () => 1
    };
    const next = keys[event.key];
    if (!next) return;
    event.preventDefault();
    setPlaying(false);
    onScrub(next());
  };

  return (
    <section className="run-scrubber" aria-label="Run playback">
      <div className="run-scrubber-controls">
        <button type="button" className="run-scrubber-play" aria-pressed={playing} onClick={() => setPlaying((current) => !current)}>
          {playing ? "Pause" : "Play"}
        </button>
        <div className="run-scrubber-speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={speed === option}
              className={speed === option ? "selected" : ""}
              onClick={() => setSpeed(option)}
            >
              {option}x
            </button>
          ))}
        </div>
        <span className="run-scrubber-time">
          {formatElapsed(moment.elapsedMs)} / {formatElapsed(model.durationMs)}
        </span>
        {/* Nothing to go back to while the workspace is already following the
            run; the button would be a control that does nothing. */}
        {scrubbing ? (
          <button type="button" className="run-scrubber-exit" onClick={onExit}>
            Back to live
          </button>
        ) : null}
      </div>

      <div
        className="run-scrubber-track"
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Run position"
        aria-valuemin={0}
        aria-valuemax={Math.round(model.durationMs)}
        aria-valuenow={Math.round(moment.elapsedMs)}
        aria-valuetext={`${formatElapsed(moment.elapsedMs)} into the run`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
      >
        <span className="run-scrubber-elapsed" style={{ transform: `scaleX(${moment.fraction})` }} />
        {model.marks.map((mark) => (
          <span
            key={mark.id}
            className={`run-scrubber-mark tone-${mark.tone} ${mark.artifactType === "screenshot" ? "screenshot" : ""}`}
            style={{ left: `${mark.fraction * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <span className="run-scrubber-head" style={{ left: `${moment.fraction * 100}%` }} aria-hidden="true" />
      </div>
    </section>
  );
}
