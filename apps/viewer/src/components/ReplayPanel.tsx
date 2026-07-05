import { useEffect, useRef, useState } from "react";
import { formatTime, type VideoReplayModel } from "../viewerPresentation.js";

export function ReplayPanel({ replay }: { replay: VideoReplayModel }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | undefined>(undefined);
  const [currentSeconds, setCurrentSeconds] = useState(0);

  useEffect(() => {
    setDurationSeconds(undefined);
    setCurrentSeconds(0);
  }, [replay.artifact.id]);

  const handleLoadedMetadata = (): void => {
    const duration = videoRef.current?.duration;
    if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
      setDurationSeconds(duration);
    }
  };

  const handleTimeUpdate = (): void => {
    const current = videoRef.current?.currentTime;
    if (current !== undefined) setCurrentSeconds(current);
  };

  const seekTo = (offsetSeconds: number): void => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, offsetSeconds);
  };

  const effectiveDuration = durationSeconds ?? fallbackDurationSeconds(replay);
  const activeMarkerIndex = lastMarkerIndexAt(replay, currentSeconds);

  return (
    <section className="replay-panel" aria-label="Session video replay">
      <div className="panel-title-row">
        <h2>Replay</h2>
        <span>
          recorded {formatTime(replay.videoStartedAt)} · {replay.markers.length} action{replay.markers.length === 1 ? "" : "s"}
        </span>
      </div>

      <video
        ref={videoRef}
        className="replay-video"
        src={replay.artifact.url}
        controls
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
      />

      {replay.markers.length > 0 && effectiveDuration ? (
        <div className="replay-marker-strip" role="group" aria-label="Action markers on the replay timeline">
          {replay.markers.map((marker, index) => {
            const leftPercent = Math.min(100, Math.max(0, (marker.offsetSeconds / effectiveDuration) * 100));
            const tone = marker.ok === false ? "bad" : marker.ok === true ? "good" : "neutral";
            return (
              <button
                key={`${marker.actionId ?? marker.kind}:${index}`}
                type="button"
                className={`replay-marker tone-${tone} ${index === activeMarkerIndex ? "active" : ""}`}
                style={{ left: `${leftPercent}%` }}
                title={`${marker.label} @ ${marker.offsetSeconds.toFixed(1)}s`}
                aria-label={`Seek to ${marker.label} at ${marker.offsetSeconds.toFixed(1)} seconds`}
                onClick={() => seekTo(marker.offsetSeconds)}
              />
            );
          })}
        </div>
      ) : null}

      <div className="replay-current" role="status" aria-live="polite">
        {activeMarkerIndex >= 0 ? (
          <>
            <strong>{replay.markers[activeMarkerIndex].label}</strong>
            <span>@ {replay.markers[activeMarkerIndex].offsetSeconds.toFixed(1)}s</span>
          </>
        ) : (
          <span>{replay.markers.length > 0 ? "Play or click a marker to follow actions." : "No actions recorded during this video."}</span>
        )}
      </div>
    </section>
  );
}

function fallbackDurationSeconds(replay: VideoReplayModel): number | undefined {
  if (replay.videoEndedAt) {
    const start = Date.parse(replay.videoStartedAt);
    const end = Date.parse(replay.videoEndedAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 1000;
  }
  const lastMarker = replay.markers.at(-1);
  return lastMarker ? Math.max(1, lastMarker.offsetSeconds) : undefined;
}

function lastMarkerIndexAt(replay: VideoReplayModel, currentSeconds: number): number {
  let index = -1;
  for (let candidate = 0; candidate < replay.markers.length; candidate += 1) {
    if (replay.markers[candidate].offsetSeconds <= currentSeconds + 0.05) index = candidate;
  }
  return index;
}
