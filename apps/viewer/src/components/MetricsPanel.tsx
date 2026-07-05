import { useEffect, useState } from "react";
import { fetchSessionMetrics } from "../api.js";
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

  if (samples.length === 0) return null;

  const cpuValues = samples.map((sample) => sample.cpuPercent);
  const rssValuesMb = samples.map((sample) => sample.rssBytes / (1024 * 1024));
  const markers = metricsMarkerFractions(samples, events);

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
        unit="%"
        values={cpuValues}
        markers={markers}
        current={cpuValues.at(-1)}
        peak={Math.max(...cpuValues)}
      />
      <Sparkline
        label="Memory"
        unit="MB"
        values={rssValuesMb}
        markers={markers}
        current={rssValuesMb.at(-1)}
        peak={Math.max(...rssValuesMb)}
      />
    </section>
  );
}

function Sparkline({
  label,
  unit,
  values,
  markers,
  current,
  peak
}: {
  label: string;
  unit: string;
  values: number[];
  markers: number[];
  current?: number;
  peak?: number;
}) {
  const points = buildSparklinePoints(values, SPARK_WIDTH, SPARK_HEIGHT);
  if (!points) return null;

  return (
    <div className="metrics-sparkline">
      <div className="metrics-sparkline-head">
        <span>{label}</span>
        <span>
          {current !== undefined ? `${formatMetric(current)}${unit}` : "--"}
          {peak !== undefined ? ` · peak ${formatMetric(peak)}${unit}` : ""}
        </span>
      </div>
      <svg viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${label} over time`}>
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
      </svg>
    </div>
  );
}

function formatMetric(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
