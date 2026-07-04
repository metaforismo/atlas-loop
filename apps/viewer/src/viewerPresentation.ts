import type { ArtifactRef, HealthState, SessionStatus } from "./types.js";

export type UiTone = "neutral" | "good" | "warn" | "bad";

export interface ArtifactSummary {
  type: string;
  count: number;
}

export function formatTime(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function healthTone(health: HealthState): UiTone {
  if (health === "online") return "good";
  if (health === "offline") return "bad";
  return "warn";
}

export function sessionTone(status: SessionStatus | undefined): UiTone {
  switch (status) {
    case "running":
    case "booted":
    case "installed":
      return "good";
    case "failed":
      return "bad";
    case "building":
    case "booting":
    case "installing":
    case "launching":
      return "warn";
    default:
      return "neutral";
  }
}

export function eventModeTone(mode: "connecting" | "sse" | "polling"): UiTone {
  if (mode === "sse") return "good";
  if (mode === "polling") return "warn";
  return "neutral";
}

export function summarizeArtifacts(artifacts: ArtifactRef[]): ArtifactSummary[] {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);

  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function latestArtifactOfType(artifacts: ArtifactRef[], type: string): ArtifactRef | undefined {
  return artifacts.find((artifact) => artifact.type === type);
}
