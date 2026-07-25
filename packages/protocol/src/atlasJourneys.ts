import type { ActionKind, AtlasMap, AtlasScreen, AtlasTransition } from "./index.js";

/**
 * User journeys derived from the Atlas map.
 *
 * A journey here is a walk the app was actually taken through during one run,
 * reconstructed from the transitions that run produced. It is deliberately not
 * a synthesised traversal of the graph: a path nobody walked is a hypothesis,
 * and this codebase reports evidence.
 */

/**
 * What a journey did, derived from the action kinds it used rather than from
 * screen names. Guessing "checkout" from an id containing the word would be
 * inventing meaning the evidence does not carry.
 */
export type AtlasJourneyCategory = "input" | "gesture" | "verified" | "navigate";

export interface AtlasJourneyStep {
  transitionId: string;
  from: string;
  to: string;
  actionId: string;
  actionKinds: ActionKind[];
  at: string;
}

export interface AtlasJourney {
  id: string;
  sessionId: string;
  /** Screens in walked order; always one longer than `steps`. */
  screenIds: string[];
  steps: AtlasJourneyStep[];
  category: AtlasJourneyCategory;
  startedAt: string;
  endedAt: string;
}

const GESTURE_KINDS = new Set<ActionKind>([
  "swipe",
  "edgeGesture",
  "longPress",
  "pinch",
  "rotate",
  "twoFingerTap"
]);

function categorise(steps: readonly AtlasJourneyStep[]): AtlasJourneyCategory {
  const kinds = new Set<ActionKind>();
  for (const step of steps) for (const kind of step.actionKinds) kinds.add(kind);

  if (kinds.has("typeText")) return "input";
  for (const kind of kinds) if (GESTURE_KINDS.has(kind)) return "gesture";
  if (kinds.has("assertVisible")) return "verified";
  return "navigate";
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Reconstructs each run's walk from the transitions it produced.
 *
 * A run's steps are ordered by time and chained while each step starts where
 * the previous one ended. A break in that chain means the app moved without a
 * recorded transition — a relaunch, or evidence that was never captured — so
 * the walk is split rather than papered over with an edge that was never
 * observed.
 */
export function deriveAtlasJourneys(map: Pick<AtlasMap, "transitions">): AtlasJourney[] {
  const bySession = new Map<string, AtlasJourneyStep[]>();

  for (const transition of map.transitions) {
    // The map arrives over the network, where `examples` may be absent. A
    // transition with none recorded contributes no steps rather than throwing
    // and taking the whole Atlas view down with it.
    const examples = Array.isArray(transition.examples) ? transition.examples : [];
    for (const example of examples) {
      if (!example || !Number.isFinite(time(example.at))) continue;
      const steps = bySession.get(example.sessionId) ?? [];
      steps.push({
        transitionId: transition.id,
        from: transition.from,
        to: transition.to,
        actionId: example.actionId,
        // Normalised once here so every consumer can iterate it.
        actionKinds: Array.isArray(transition.actionKinds) ? transition.actionKinds : [],
        at: example.at
      });
      bySession.set(example.sessionId, steps);
    }
  }

  const journeys: AtlasJourney[] = [];
  for (const [sessionId, steps] of [...bySession.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    steps.sort((left, right) => time(left.at) - time(right.at) || left.transitionId.localeCompare(right.transitionId));

    let current: AtlasJourneyStep[] = [];
    const flush = (): void => {
      if (current.length === 0) return;
      const walked = current;
      current = [];
      journeys.push({
        id: `${sessionId}:${walked[0]!.transitionId}:${walked[0]!.at}`,
        sessionId,
        screenIds: [walked[0]!.from, ...walked.map((step) => step.to)],
        steps: walked,
        category: categorise(walked),
        startedAt: walked[0]!.at,
        endedAt: walked[walked.length - 1]!.at
      });
    };

    for (const step of steps) {
      const previous = current[current.length - 1];
      if (previous && previous.to !== step.from) flush();
      current.push(step);
    }
    flush();
  }

  return journeys;
}

/**
 * The synthetic node a launch edge starts from. It is not a captured screen,
 * so it never has a screenshot and needs its own name.
 */
export const ATLAS_LAUNCH_NODE = "__launch__";

/**
 * A short name for a screen: its explicit identifier when the evidence carried
 * one, otherwise a trimmed id. Never a guess at what the screen "is".
 */
export function atlasScreenLabel(screen: Pick<AtlasScreen, "id" | "screenId"> | undefined, fallbackId: string): string {
  const explicit = screen?.screenId?.trim();
  if (explicit) return explicit;
  const id = screen?.id ?? fallbackId;
  if (id === ATLAS_LAUNCH_NODE) return "Launch";
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

/** "Home → Checkout", from the endpoints an operator can recognise. */
export function atlasJourneyLabel(journey: AtlasJourney, screens: readonly AtlasScreen[]): string {
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  const first = journey.screenIds[0]!;
  const last = journey.screenIds[journey.screenIds.length - 1]!;
  const start = atlasScreenLabel(byId.get(first), first);
  const end = atlasScreenLabel(byId.get(last), last);
  return start === end ? start : `${start} → ${end}`;
}

/**
 * Longest first, because a longer walk covers more of the app; ties break on
 * recency so a repeated flow shows its newest run.
 */
export function sortAtlasJourneys(journeys: readonly AtlasJourney[]): AtlasJourney[] {
  return [...journeys].sort(
    (left, right) => right.steps.length - left.steps.length || time(right.endedAt) - time(left.endedAt)
  );
}

export interface AtlasJourneyTotals {
  journeys: number;
  byCategory: Record<AtlasJourneyCategory, number>;
  longest: number;
}

export function summariseAtlasJourneys(journeys: readonly AtlasJourney[]): AtlasJourneyTotals {
  const byCategory: Record<AtlasJourneyCategory, number> = { input: 0, gesture: 0, verified: 0, navigate: 0 };
  let longest = 0;
  for (const journey of journeys) {
    byCategory[journey.category] += 1;
    if (journey.steps.length > longest) longest = journey.steps.length;
  }
  return { journeys: journeys.length, byCategory, longest };
}

/** Screens and transitions on a journey, for dimming everything else. */
export function atlasJourneyHighlight(journey: AtlasJourney | undefined): {
  screenIds: Set<string>;
  transitionIds: Set<string>;
} {
  return {
    screenIds: new Set(journey?.screenIds ?? []),
    transitionIds: new Set(journey?.steps.map((step) => step.transitionId) ?? [])
  };
}

export type { AtlasTransition };
