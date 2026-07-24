import type { ArtifactHealth, ArtifactRef, Session, SessionSummary, TraceEvent } from "./types.js";

/**
 * Turns a run into a ready-to-file issue.
 *
 * A ticket that says "login sometimes fails" makes whoever picks it up — human
 * or agent — reconstruct the run from scratch. The draft below carries the
 * failing step, the reason, the device, and a deep link back to the exact
 * evidence, so the context travels with the work instead of staying here.
 *
 * Everything is derived from evidence already loaded in the viewer. Nothing is
 * invented: a field with no recorded value says so rather than guessing.
 */

/**
 * Practical ceiling for a prefilled issue URL. GitHub rejects request lines
 * beyond roughly 8KB, and a truncated body is worse than no deep link, so the
 * caller falls back to copying the markdown when a draft exceeds this.
 */
export const ISSUE_URL_LIMIT = 6000;

const UNKNOWN = "Not recorded";

export interface IssueField {
  label: string;
  value: string;
}

export interface FailedStep {
  /** 1-based position in the run, matching what the Steps list shows. */
  position: number;
  actionId: string;
  kind: string;
  reason: string;
  at?: string;
}

export interface IssueDraft {
  title: string;
  /** Markdown body, ready to paste or to hand to a deep link. */
  body: string;
  runFields: IssueField[];
  failedStep?: FailedStep;
  /** Deep link back to the exact evidence this issue is about. */
  evidenceUrl: string;
}

export interface IssueDraftInput {
  session?: Session;
  sessionSummary?: SessionSummary;
  artifacts: ArtifactRef[];
  events: TraceEvent[];
  artifactHealth?: ArtifactHealth;
  /** Absolute viewer URL for the run, used as the evidence deep link. */
  evidenceUrl: string;
  /** Free-text the operator added before filing. */
  notes?: string;
}

function firstText(...values: Array<string | undefined>): string {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? UNKNOWN;
}

/**
 * The first action that did not pass, with the reason recorded against it.
 *
 * Position counts completed actions rather than trace events so it lines up
 * with the numbered step list an operator is looking at.
 */
export function findFirstFailedStep(events: TraceEvent[]): FailedStep | undefined {
  const startedByActionId = new Map<string, TraceEvent>();
  let position = 0;

  for (const event of events) {
    if (event.type === "action.started" && event.action?.id) {
      startedByActionId.set(event.action.id, event);
      continue;
    }
    if (event.type !== "action.completed" || !event.result) continue;

    position += 1;
    if (event.result.ok !== false) continue;

    const started = startedByActionId.get(event.result.actionId);
    return {
      position,
      actionId: event.result.actionId,
      kind: started?.action?.kind ?? "unknown",
      reason: firstText(event.result.error?.message, event.error?.message),
      at: event.at ?? event.result.endedAt
    };
  }

  return undefined;
}

function countActionOutcomes(events: TraceEvent[]): { passed: number; total: number } {
  let passed = 0;
  let total = 0;
  for (const event of events) {
    if (event.type !== "action.completed" || !event.result) continue;
    total += 1;
    if (event.result.ok !== false) passed += 1;
  }
  return { passed, total };
}

function runFields(input: IssueDraftInput, failedStep: FailedStep | undefined): IssueField[] {
  const { session, sessionSummary, artifacts, events, artifactHealth } = input;
  const outcomes = countActionOutcomes(events);
  const result = failedStep ? "failed" : session?.status === "ended" ? "passed" : (session?.status ?? UNKNOWN);

  return [
    { label: "Session", value: firstText(session?.id) },
    { label: "App", value: firstText(session?.app?.bundleId, session?.app?.scheme, session?.app?.appPath) },
    { label: "Platform", value: firstText(session?.platform, session?.simulator?.runtime) },
    { label: "Device", value: firstText(session?.simulator?.name) },
    { label: "Runtime", value: firstText(session?.simulator?.runtime) },
    { label: "Input backend", value: firstText(session?.inputBackend, session?.backend) },
    { label: "Result", value: result },
    { label: "Actions", value: outcomes.total === 0 ? "None recorded" : `${outcomes.passed}/${outcomes.total} passed` },
    { label: "Evidence", value: `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}` },
    {
      label: "Evidence health",
      value: artifactHealth ? (artifactHealth.ok ? "clean" : `${artifactHealth.summary.issueCount} issue${artifactHealth.summary.issueCount === 1 ? "" : "s"}`) : UNKNOWN
    },
    { label: "Storage", value: firstText(sessionSummary?.storage.source) },
    { label: "Started", value: firstText(session?.createdAt) }
  ];
}

function markdownTable(fields: IssueField[]): string {
  return [
    "| Field | Value |",
    "| --- | --- |",
    ...fields.map((field) => `| ${field.label} | ${field.value} |`)
  ].join("\n");
}

export function buildIssueDraft(input: IssueDraftInput): IssueDraft {
  const failedStep = findFirstFailedStep(input.events);
  const fields = runFields(input, failedStep);
  const app = fields.find((field) => field.label === "App")?.value ?? UNKNOWN;
  const title = failedStep
    ? `${app}: ${failedStep.kind} failed at step ${failedStep.position}`
    : `Investigate Atlas Loop run: ${input.session?.id ?? "unknown session"}`;

  const sections = [
    "## Run",
    markdownTable(fields),
    "",
    "## First failed step",
    failedStep
      ? [
          `- **Step:** ${failedStep.position}`,
          `- **Action:** \`${failedStep.kind}\` (\`${failedStep.actionId}\`)`,
          `- **Reason:** ${failedStep.reason}`,
          ...(failedStep.at ? [`- **At:** ${failedStep.at}`] : [])
        ].join("\n")
      : "No failed action was recorded for this run.",
    "",
    "## Evidence",
    `[Open the run in Atlas Loop](${input.evidenceUrl})`,
    "",
    "Evidence stays on the machine that produced it; this link resolves against that local daemon."
  ];

  const notes = input.notes?.trim();
  if (notes) sections.push("", "## Notes", notes);

  return { title, body: sections.join("\n"), runFields: fields, failedStep, evidenceUrl: input.evidenceUrl };
}

export interface IssueTarget {
  id: "linear" | "github";
  label: string;
  /** Undefined when the draft is too long to survive a URL. */
  url?: string;
}

/**
 * Deep links that open a prefilled issue form. `repository` is only needed for
 * GitHub; without it that target is omitted rather than guessed at.
 */
export function buildIssueTargets(draft: IssueDraft, repository?: string): IssueTarget[] {
  const targets: IssueTarget[] = [
    { id: "linear", label: "Linear", url: withinLimit(`https://linear.app/new?title=${encodeURIComponent(draft.title)}&description=${encodeURIComponent(draft.body)}`) }
  ];

  const slug = normalizeRepository(repository);
  if (slug) {
    targets.push({
      id: "github",
      label: "GitHub",
      url: withinLimit(`https://github.com/${slug}/issues/new?title=${encodeURIComponent(draft.title)}&body=${encodeURIComponent(draft.body)}`)
    });
  }

  return targets;
}

function withinLimit(url: string): string | undefined {
  return url.length <= ISSUE_URL_LIMIT ? url : undefined;
}

/**
 * Accepts `owner/repo` or a full GitHub URL. Anything else is rejected rather
 * than pasted into a link that would 404.
 */
export function normalizeRepository(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const fromUrl = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i.exec(trimmed);
  const owner = fromUrl?.[1] ?? /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed)?.[1];
  const repo = fromUrl?.[2] ?? /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed)?.[2];
  if (!owner || !repo) return undefined;

  return `${owner}/${repo.replace(/\.git$/i, "")}`;
}
