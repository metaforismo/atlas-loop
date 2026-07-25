import { useEffect, useMemo, useState } from "react";
import { filterDeviceLogs, summariseDeviceLogs, type DeviceLogEntry, type DeviceLogLevel } from "@atlas-loop/protocol";
import { fetchSessionDeviceLogs } from "../api.js";
import type { Session, ViewerParams } from "../types.js";
import { formatTime } from "../viewerPresentation.js";

const LEVELS: Array<{ id: DeviceLogLevel | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "error", label: "Errors" },
  { id: "fault", label: "Faults" },
  { id: "default", label: "Default" },
  { id: "info", label: "Info" },
  { id: "debug", label: "Debug" }
];

const VISIBLE_LIMIT = 200;

/**
 * Device logs for the run, scoped to a step when one is selected.
 *
 * A wall of OS log lines beside a failure is close to useless; the same lines
 * narrowed to the step that failed usually contain the reason. The panel
 * therefore defaults to the selected action rather than the whole capture.
 */
export function DeviceLogsPanel({
  params,
  sessionStatus,
  selectedActionId
}: {
  params: ViewerParams;
  sessionStatus: Session["status"] | undefined;
  selectedActionId?: string;
}) {
  const [entries, setEntries] = useState<DeviceLogEntry[]>([]);
  const [steps, setSteps] = useState<Array<{ actionId: string; entries: DeviceLogEntry[] }>>([]);
  const [truncated, setTruncated] = useState(false);
  const [level, setLevel] = useState<DeviceLogLevel | "all">("all");
  const [query, setQuery] = useState("");
  const [scopeToStep, setScopeToStep] = useState(true);

  useEffect(() => {
    setEntries([]);
    setSteps([]);
    setTruncated(false);
  }, [params.daemonUrl, params.sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const load = async (): Promise<void> => {
      try {
        const view = await fetchSessionDeviceLogs(params, controller.signal);
        if (controller.signal.aborted) return;
        setEntries(view.entries);
        setSteps(view.alignment.steps);
        setTruncated(view.truncated);
      } catch {
        // A daemon without device logs is not an error state for this panel.
      }
    };

    void load();
    if (sessionStatus === "running") timer = window.setInterval(() => void load(), 4000);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [params.daemonUrl, params.sessionId, sessionStatus]);

  const stepEntries = useMemo(
    () => (selectedActionId ? steps.find((step) => step.actionId === selectedActionId)?.entries ?? [] : undefined),
    [steps, selectedActionId]
  );
  const scoped = scopeToStep && stepEntries !== undefined ? stepEntries : entries;
  const visible = useMemo(() => {
    const matched = filterDeviceLogs(scoped, query);
    return level === "all" ? matched : matched.filter((entry) => entry.level === level);
  }, [scoped, query, level]);
  const summary = useMemo(() => summariseDeviceLogs(visible), [visible]);

  if (entries.length === 0) return null;

  return (
    <section className="device-logs" aria-labelledby="device-logs-title">
      <div className="panel-title-row">
        <h2 id="device-logs-title">Device logs</h2>
        <span>
          {summary.total} line{summary.total === 1 ? "" : "s"}
          {summary.problems > 0 ? ` · ${summary.problems} problem${summary.problems === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {stepEntries !== undefined ? (
        <label className="device-logs-scope">
          <input type="checkbox" checked={scopeToStep} onChange={(event) => setScopeToStep(event.target.checked)} />
          <span>
            Only the selected step
            <small>{stepEntries.length} of {entries.length} lines</small>
          </span>
        </label>
      ) : null}

      <div className="device-logs-controls">
        <div className="device-logs-levels" role="group" aria-label="Log level filter">
          {LEVELS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={level === option.id}
              className={level === option.id ? "selected" : ""}
              onClick={() => setLevel(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="search-field compact">
          <span className="sr-only">Search device logs</span>
          <input
            type="search"
            value={query}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs…"
          />
        </label>
      </div>

      {truncated ? (
        <p className="device-logs-truncated" role="status">
          Capture hit its size limit, so this run's logs are partial.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="device-logs-empty">No lines match this filter.</p>
      ) : (
        <ol className="device-logs-list">
          {/* Newest lines are the ones being read; older ones stay behind the count. */}
          {visible.slice(-VISIBLE_LIMIT).map((entry, index) => (
            <li key={`${entry.at}:${index}`} className={`tone-${entry.level}`}>
              <time>{formatTime(entry.at)}</time>
              <span className="device-logs-level">{entry.level}</span>
              <span className="device-logs-source" title={[entry.subsystem, entry.category].filter(Boolean).join(" · ")}>
                {entry.subsystem ?? entry.process ?? "—"}
              </span>
              <p title={entry.message}>{entry.message}</p>
            </li>
          ))}
        </ol>
      )}

      {visible.length > VISIBLE_LIMIT ? (
        <p className="device-logs-more">
          Showing the newest {VISIBLE_LIMIT} of {visible.length} matching lines.
        </p>
      ) : null}
    </section>
  );
}
