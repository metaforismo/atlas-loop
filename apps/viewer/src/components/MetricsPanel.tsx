import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { formatBytes, summariseMetrics, type MetricsSample } from "@atlas-loop/protocol";
import { fetchSessionMetrics } from "../api.js";
import { elapsedLabel, peakReading, readingAtFraction } from "../metricsInspection.js";
import type { Session, TraceEvent, ViewerParams } from "../types.js";
import { buildSparklinePoints, metricsMarkerFractions, type MetricsSampleLike } from "../viewerPresentation.js";

const SPARK_WIDTH = 260;
const SPARK_HEIGHT = 48;

export function MetricsPanel({
  params,
  sessionStatus,
  events
}: {
  params: ViewerParams;
  sessionStatus: Session["status"] | undefined;
  events: TraceEvent[];
}) {
  const [samples, setSamples] = useState<MetricsSampleLike[]>([]);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setSamples([]);
    setActive(false);
  }, [params.daemonUrl, params.sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const load = async (): Promise<void> => {
      try {
        const metrics = await fetchSessionMetrics(params, controller.signal);
        if (controller.signal.aborted) return;
        setSamples(metrics.samples);
        setActive(metrics.active);
      } catch {
        if (!controller.signal.aborted) setActive(false);
      }
    };

    void load();
    if (sessionStatus === "running") {
      timer = window.setInterval(() => void load(), 2000);
    }
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [params.daemonUrl, params.sessionId, sessionStatus]);

  // The same summariser the CLI and the MCP server use, so all three report
  // one number rather than three near-identical implementations of a peak.
  const summary = useMemo(() => summariseMetrics(samples as MetricsSample[]), [samples]);
  const markers = useMemo(() => metricsMarkerFractions(samples, events), [samples, events]);

  if (samples.length === 0) return null;

  return (
    <section className="metrics-panel" aria-label="App performance metrics">
      <div className="panel-title-row">
        <h2>App metrics</h2>
        <span>
          {samples.length} sample{samples.length === 1 ? "" : "s"} · {active ? "sampling" : "final"}
        </span>
      </div>

      <Sparkline
        label="CPU"
        samples={samples}
        markers={markers}
        read={readCpu}
        format={formatPercent}
        peak={summary.cpuPercent?.max}
      />
      <Sparkline
        label="Memory"
        samples={samples}
        markers={markers}
        read={readRss}
        format={formatBytes}
        peak={summary.rssBytes?.max}
      />
    </section>
  );
}

function Sparkline({
  label,
  samples,
  markers,
  read,
  format,
  peak
}: {
  label: string;
  samples: MetricsSampleLike[];
  markers: number[];
  read: (sample: MetricsSampleLike) => number;
  format: (value: number) => string;
  peak?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number>();
  const values = useMemo(() => samples.map(read), [samples, read]);
  const points = buildSparklinePoints(values, SPARK_WIDTH, SPARK_HEIGHT);
  const peakPoint = useMemo(() => peakReading(samples, read), [samples, read]);

  useEffect(() => {
    setHoverIndex(undefined);
  }, [samples]);

  if (!points) return null;

  const hovered = hoverIndex === undefined ? undefined : samples[hoverIndex];
  const shown = hovered ?? samples.at(-1);
  const denominator = Math.max(1, samples.length - 1);

  const trackPointer = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0) return;
    setHoverIndex(readingAtFraction(samples, (event.clientX - bounds.left) / bounds.width)?.index);
  };

  return (
    <div className="metrics-sparkline">
      <div className="metrics-sparkline-head">
        <span>{label}</span>
        <span>
          {shown ? format(read(shown)) : "--"}
          {/* Hovering answers "what was it here?"; otherwise the peak stands. */}
          {hovered ? <em> at {elapsedLabel(samples, hovered)}</em> : null}
          {!hovered && peak !== undefined && peakPoint ? (
            <em> · peak {format(peak)} at {elapsedLabel(samples, peakPoint.sample)}</em>
          ) : null}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={
          peak !== undefined && peakPoint
            ? `${label} over time, peaking at ${format(peak)} ${elapsedLabel(samples, peakPoint.sample)} into the run`
            : `${label} over time`
        }
        onPointerMove={trackPointer}
        onPointerLeave={() => setHoverIndex(undefined)}
      >
        {markers.map((fraction, index) => (
          <line
            key={`${fraction}:${index}`}
            className="metrics-marker"
            x1={fraction * SPARK_WIDTH}
            x2={fraction * SPARK_WIDTH}
            y1={0}
            y2={SPARK_HEIGHT}
          />
        ))}
        <polyline className="metrics-line" points={points} fill="none" />
        {peakPoint ? (
          <line
            className="metrics-peak"
            x1={peakPoint.fraction * SPARK_WIDTH}
            x2={peakPoint.fraction * SPARK_WIDTH}
            y1={0}
            y2={SPARK_HEIGHT}
          />
        ) : null}
        {hoverIndex !== undefined ? (
          <line
            className="metrics-cursor"
            x1={(hoverIndex / denominator) * SPARK_WIDTH}
            x2={(hoverIndex / denominator) * SPARK_WIDTH}
            y1={0}
            y2={SPARK_HEIGHT}
          />
        ) : null}
      </svg>
    </div>
  );
}

function readCpu(sample: MetricsSampleLike): number {
  return sample.cpuPercent;
}

function readRss(sample: MetricsSampleLike): number {
  return sample.rssBytes;
}

function formatPercent(value: number): string {
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)}%`;
}
