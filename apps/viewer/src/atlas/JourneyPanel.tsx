import { useEffect, useMemo, useState } from "react";
import {
  atlasJourneyLabel,
  atlasScreenLabel,
  sortAtlasJourneys,
  summariseAtlasJourneys,
  type AtlasJourney,
  type AtlasJourneyCategory
} from "@atlas-loop/protocol";
import type { AtlasScreenLike } from "./atlasApi.js";

const CATEGORY_LABELS: Record<AtlasJourneyCategory, string> = {
  input: "Input",
  gesture: "Gesture",
  verified: "Verified",
  navigate: "Navigate"
};

/**
 * The journeys a run actually walked, and a step-by-step walker for the
 * selected one. Reading a dense graph is hard; reading one path through it,
 * a step at a time, is not.
 */
export function JourneyPanel({
  journeys,
  screens,
  selectedJourneyId,
  stepIndex,
  onSelectJourney,
  onStepChange
}: {
  journeys: AtlasJourney[];
  screens: AtlasScreenLike[];
  selectedJourneyId?: string;
  stepIndex: number;
  onSelectJourney: (journeyId: string | undefined) => void;
  onStepChange: (index: number) => void;
}) {
  const ordered = useMemo(() => sortAtlasJourneys(journeys), [journeys]);
  const totals = useMemo(() => summariseAtlasJourneys(journeys), [journeys]);
  const selected = ordered.find((journey) => journey.id === selectedJourneyId);
  const screenList = screens as never as Parameters<typeof atlasJourneyLabel>[1];

  if (ordered.length === 0) {
    return (
      <section className="atlas-journeys" aria-labelledby="atlas-journeys-title">
        <div className="panel-title-row">
          <h2 id="atlas-journeys-title">User journeys</h2>
        </div>
        <p className="atlas-journeys-empty">
          No walk has been recorded yet. Journeys appear once a run moves between screens.
        </p>
      </section>
    );
  }

  if (selected) {
    return (
      <JourneyWalker
        journey={selected}
        screens={screens}
        stepIndex={stepIndex}
        onStepChange={onStepChange}
        onBack={() => onSelectJourney(undefined)}
      />
    );
  }

  return (
    <section className="atlas-journeys" aria-labelledby="atlas-journeys-title">
      <div className="panel-title-row">
        <h2 id="atlas-journeys-title">User journeys</h2>
        <span>{totals.journeys} walked</span>
      </div>
      <ul className="atlas-journey-list">
        {ordered.map((journey) => (
          <li key={journey.id}>
            <button type="button" onClick={() => onSelectJourney(journey.id)}>
              <span className={`atlas-journey-tag tone-${journey.category}`}>{CATEGORY_LABELS[journey.category]}</span>
              <strong>{atlasJourneyLabel(journey, screenList)}</strong>
              <small>
                {journey.screenIds.length} screen{journey.screenIds.length === 1 ? "" : "s"} · {journey.sessionId}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function JourneyWalker({
  journey,
  screens,
  stepIndex,
  onStepChange,
  onBack
}: {
  journey: AtlasJourney;
  screens: AtlasScreenLike[];
  stepIndex: number;
  onStepChange: (index: number) => void;
  onBack: () => void;
}) {
  const byId = useMemo(() => new Map(screens.map((screen) => [screen.id, screen])), [screens]);
  const total = journey.screenIds.length;
  // A journey can shrink when the map rebuilds; never point past its end.
  const current = Math.min(Math.max(0, stepIndex), total - 1);

  useEffect(() => {
    if (current !== stepIndex) onStepChange(current);
  }, [current, stepIndex, onStepChange]);

  return (
    <section className="atlas-journeys atlas-journey-walker" aria-labelledby="atlas-journey-walker-title">
      <div className="panel-title-row">
        <button type="button" className="atlas-journey-back" onClick={onBack}>
          ← All journeys
        </button>
        <span>
          Step {current + 1} of {total}
        </span>
      </div>

      <h2 id="atlas-journey-walker-title">{atlasJourneyLabel(journey, screens as never)}</h2>

      <div className="atlas-journey-controls">
        <button type="button" disabled={current === 0} onClick={() => onStepChange(current - 1)}>
          Previous
        </button>
        <button type="button" disabled={current >= total - 1} onClick={() => onStepChange(current + 1)}>
          Next
        </button>
      </div>

      <ol className="atlas-journey-steps">
        {journey.screenIds.map((screenId, index) => {
          // The step that led here; the first screen was not arrived at.
          const arrival = index > 0 ? journey.steps[index - 1] : undefined;
          return (
            <li key={`${screenId}:${index}`} className={index === current ? "current" : ""}>
              <button type="button" aria-current={index === current ? "step" : undefined} onClick={() => onStepChange(index)}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span>
                  <strong>{atlasScreenLabel(byId.get(screenId) as never, screenId)}</strong>
                  <small>{arrival ? arrival.actionKinds.join(", ") : "entry point"}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
