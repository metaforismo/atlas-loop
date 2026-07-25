import { useEffect, useMemo, useState } from "react";
import {
  exchangeLabel,
  filterNetworkExchanges,
  formatBytes,
  formatDuration,
  networkTone,
  summariseNetworkExchanges,
  type NetworkExchange,
  type NetworkFilterKind
} from "@atlas-loop/protocol";
import { fetchSessionNetwork } from "../api.js";
import type { Session, ViewerParams } from "../types.js";

const VISIBLE_LIMIT = 150;

const KINDS: Array<{ id: NetworkFilterKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "problems", label: "Problems" },
  { id: "tunnelled", label: "Unread" }
];

/**
 * What the app asked the network for, scoped to a step when one is selected.
 *
 * A screenshot shows a spinner. It does not show which endpoint the app called,
 * what came back, or how long it blocked. The panel defaults to the selected
 * step, because a wall of requests beside a failure is close to useless while
 * the same requests narrowed to the failing step usually contain the reason.
 */
export function NetworkPanel({
  params,
  sessionStatus,
  selectedActionId,
  embedded,
  onHeadline
}: {
  params: ViewerParams;
  sessionStatus: Session["status"] | undefined;
  selectedActionId?: string;
  /** Rendered inside the evidence tabs, which supply the frame and the title. */
  embedded?: boolean;
  onHeadline?: (headline: { count?: string; attention?: number }) => void;
}) {
  const [exchanges, setExchanges] = useState<NetworkExchange[]>([]);
  const [steps, setSteps] = useState<Array<{ actionId: string; exchanges: NetworkExchange[] }>>([]);
  const [active, setActive] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [proxyUrl, setProxyUrl] = useState<string>();
  const [kind, setKind] = useState<NetworkFilterKind>("all");
  const [query, setQuery] = useState("");
  const [scopeToStep, setScopeToStep] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExchanges([]);
    setSteps([]);
  }, [params.daemonUrl, params.sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const load = async (): Promise<void> => {
      try {
        const view = await fetchSessionNetwork(params, controller.signal);
        if (controller.signal.aborted) return;
        setExchanges(view.exchanges);
        setSteps(view.alignment.steps);
        setActive(view.active);
        setReceiving(view.receiving);
        setProxyUrl(view.proxyUrl);
      } catch {
        // A daemon without network capture is not an error state for this panel.
      }
    };

    void load();
    if (sessionStatus === "running") timer = window.setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [params.daemonUrl, params.sessionId, sessionStatus]);

  const stepExchanges = useMemo(
    () => (selectedActionId ? steps.find((step) => step.actionId === selectedActionId)?.exchanges ?? [] : undefined),
    [steps, selectedActionId]
  );
  const scoped = scopeToStep && stepExchanges !== undefined ? stepExchanges : exchanges;
  const visible = useMemo(() => filterNetworkExchanges(scoped, { search: query, kind }), [scoped, query, kind]);
  const summary = useMemo(() => summariseNetworkExchanges(visible), [visible]);
  // The tab strip reports on the whole capture, not the current filter: a tab
  // that changed as you typed in the search box would be useless.
  const whole = useMemo(() => summariseNetworkExchanges(exchanges), [exchanges]);
  const problems = whole.failed + whole.errors;

  useEffect(() => {
    if (exchanges.length === 0 && !active) {
      onHeadline?.({});
      return;
    }
    onHeadline?.({ count: String(whole.total), attention: problems || undefined });
  }, [exchanges.length, active, whole.total, problems, onHeadline]);

  // A capture nobody has routed traffic into looks exactly like an app that
  // stayed quiet, so the panel appears to say which it is.
  if (exchanges.length === 0 && !active) return null;

  const body = (
    <>
      {!embedded ? (
        <div className="panel-title-row">
          <h2 id="network-title">Network</h2>
          <span>{describeOutcomes(summary)}</span>
        </div>
      ) : null}

      {active && !receiving ? (
        <p className="network-caveat">
          The capture proxy is running on <code>{proxyUrl}</code> but nothing has reached it yet. The Simulator takes its
          proxy settings from this Mac&rsquo;s network settings &mdash; until they point here, an empty capture is not
          evidence the app stayed quiet.
        </p>
      ) : null}

      {stepExchanges !== undefined ? (
        <label className="network-scope">
          <input type="checkbox" checked={scopeToStep} onChange={(event) => setScopeToStep(event.target.checked)} />
          <span>
            Only the selected step
            <small>
              {stepExchanges.length} of {exchanges.length} request{exchanges.length === 1 ? "" : "s"}
            </small>
          </span>
        </label>
      ) : null}

      <div className="network-controls">
        <div className="network-kinds" role="group" aria-label="Filter requests">
          {KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={kind === option.id}
              className={kind === option.id ? "selected" : ""}
              onClick={() => setKind(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="search-field compact">
          <span className="sr-only">Search requests</span>
          {/* Hosts and paths are not words either. */}
          <input
            type="search"
            value={query}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search requests…"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="network-empty">No requests match.</p>
      ) : (
        <ul className="network-rows">
          {(expanded ? visible : visible.slice(0, VISIBLE_LIMIT)).map((exchange) => (
            <li key={exchange.id} className={`tone-${networkTone(exchange)}`}>
              <span className="network-method">{exchange.method}</span>
              <span className="network-target" title={exchangeLabel(exchange)}>
                {exchangeLabel(exchange)}
              </span>
              <span className="network-status">{exchange.status ?? (exchange.tunnelled ? "tunnel" : "failed")}</span>
              <span className="network-timing">{formatDuration(exchange.durationMs)}</span>
              <span className="network-bytes">{formatBytes(exchange.responseBytes)}</span>
              {/* A redacted header is worth knowing about: it says the request
                  carried a credential without ever storing the credential. */}
              {exchange.redactedHeaders?.length ? (
                <span className="network-redacted" title={`Values dropped: ${exchange.redactedHeaders.join(", ")}`}>
                  redacted
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {visible.length > VISIBLE_LIMIT ? (
        <button type="button" className="network-more" onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Show fewer" : `Show all ${visible.length} requests`}
        </button>
      ) : null}

      {summary.slowest && summary.total > 1 ? (
        <p className="network-footnote">
          {describeOutcomes(summary)} &middot; slowest <strong>{exchangeLabel(summary.slowest)}</strong> at{" "}
          {formatDuration(summary.slowestMs)}
        </p>
      ) : null}
    </>
  );

  return embedded ? (
    <div className="network-panel embedded">{body}</div>
  ) : (
    <section className="network-panel" aria-labelledby="network-title">
      {body}
    </section>
  );
}

/**
 * A server that answered 4xx or 5xx refused the request; one that never
 * answered leaves the app not knowing what happened. Collapsing both into
 * "failed" loses the distinction that decides what to do next.
 */
function describeOutcomes(summary: { total: number; errors: number; failed: number }): string {
  const parts = [`${summary.total} request${summary.total === 1 ? "" : "s"}`];
  if (summary.errors > 0) parts.push(`${summary.errors} refused`);
  if (summary.failed > 0) parts.push(`${summary.failed} unanswered`);
  return parts.join(" · ");
}
