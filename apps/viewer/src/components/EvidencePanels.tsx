import { useCallback, useMemo } from "react";
import { useTabListKeys } from "../useTabListKeys.js";
import { MetricsPanel } from "./MetricsPanel.js";
import { NetworkPanel } from "./NetworkPanel.js";
import { SessionStatePanel } from "./SessionStatePanel.js";
import type { Session, TraceEvent, ViewerParams } from "../types.js";

export type EvidenceTabId = "metrics" | "network" | "state";

export interface EvidenceHeadline {
  /** Short count for the tab, e.g. `95` or `5`. Absent while a panel has nothing. */
  count?: string;
  /** Something worth looking at, shown as a marker on the tab. */
  attention?: number;
}

const TABS: Array<{ id: EvidenceTabId; label: string }> = [
  { id: "metrics", label: "Metrics" },
  { id: "network", label: "Network" },
  { id: "state", label: "Stored data" }
];

/**
 * The run's evidence streams, in one place.
 *
 * Stacked as separate panels these three competed with the device viewport and
 * with each other: four bordered boxes in a narrow column, each squeezed to a
 * couple of hundred pixels, with the device itself pushed out entirely. As tabs
 * they get the full height when you are looking at one, and the tab strip still
 * carries each stream's headline, so "Network has 3 problems" is visible without
 * opening it.
 *
 * All three stay mounted. They poll the daemon and hold filter state, and
 * remounting on every tab switch would restart the polling and lose it.
 */
export function EvidencePanels({
  params,
  session,
  events,
  selectedActionId,
  cursorAt,
  selected,
  onSelect,
  headlines,
  onHeadlines
}: {
  params: ViewerParams;
  session: Session | undefined;
  events: TraceEvent[];
  selectedActionId?: string;
  cursorAt?: string;
  selected: EvidenceTabId;
  onSelect: (id: EvidenceTabId) => void;
  headlines: Partial<Record<EvidenceTabId, EvidenceHeadline>>;
  onHeadlines: (next: (current: Partial<Record<EvidenceTabId, EvidenceHeadline>>) => Partial<Record<EvidenceTabId, EvidenceHeadline>>) => void;
}) {

  const report = useCallback(
    (id: EvidenceTabId, headline: EvidenceHeadline) => {
      onHeadlines((current) => {
        const previous = current[id];
        if (previous?.count === headline.count && previous?.attention === headline.attention) return current;
        return { ...current, [id]: headline };
      });
    },
    [onHeadlines]
  );

  const onMetrics = useCallback((headline: EvidenceHeadline) => report("metrics", headline), [report]);
  const onNetwork = useCallback((headline: EvidenceHeadline) => report("network", headline), [report]);
  const onState = useCallback((headline: EvidenceHeadline) => report("state", headline), [report]);

  // A stream with nothing recorded is not worth a tab; the run may simply not
  // have used it.
  const available = useMemo(() => TABS.filter((tab) => headlines[tab.id]?.count !== undefined), [headlines]);
  const active = available.some((tab) => tab.id === selected) ? selected : available[0]?.id;
  const keys = useTabListKeys(
    available.map((tab) => tab.id),
    (active ?? "metrics") as EvidenceTabId,
    onSelect
  );

  return (
    <section className={`evidence-panels${available.length === 0 ? " empty" : ""}`} aria-label="Run evidence">
      {available.length > 0 ? (
        <div
          className="panel-tabs-strip"
          role="tablist"
          aria-label="Evidence stream"
          ref={keys.ref}
          onKeyDown={keys.onKeyDown}
        >
          {available.map((tab) => {
            const headline = headlines[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`evidence-tab-${tab.id}`}
                aria-selected={active === tab.id}
                aria-controls={`evidence-body-${tab.id}`}
                tabIndex={keys.tabIndex(tab.id)}
                className={active === tab.id ? "selected" : ""}
                onClick={() => onSelect(tab.id)}
              >
                {tab.label}
                {headline?.count ? <span className="panel-tab-badge">{headline.count}</span> : null}
                {headline?.attention ? (
                  <span className="panel-tab-attention" title={`${headline.attention} need attention`}>
                    {headline.attention}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {/*
        Hidden rather than unmounted, and always in this same position.
        These poll and hold filter state, and moving a panel between two
        different places in the tree remounts it: an earlier version rendered
        them elsewhere while no tab existed yet, and the remount reset the state
        that decided whether a tab existed, which flipped back and forth
        forever.
      */}
      <div id="evidence-body-metrics" role="tabpanel" aria-labelledby="evidence-tab-metrics" hidden={active !== "metrics"}>
        <MetricsPanel
          params={params}
          sessionStatus={session?.status}
          events={events}
          cursorAt={cursorAt}
          embedded
          onHeadline={onMetrics}
        />
      </div>
      <div id="evidence-body-network" role="tabpanel" aria-labelledby="evidence-tab-network" hidden={active !== "network"}>
        <NetworkPanel
          params={params}
          sessionStatus={session?.status}
          selectedActionId={selectedActionId}
          embedded
          onHeadline={onNetwork}
        />
      </div>
      <div id="evidence-body-state" role="tabpanel" aria-labelledby="evidence-tab-state" hidden={active !== "state"}>
        <SessionStatePanel params={params} sessionStatus={session?.status} embedded onHeadline={onState} />
      </div>
    </section>
  );
}
