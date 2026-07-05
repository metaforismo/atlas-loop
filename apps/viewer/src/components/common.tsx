import type { UiTone } from "../viewerPresentation.js";

export function EmptyState({ title, detail, horizontal = false, compact = false }: { title: string; detail: string; horizontal?: boolean; compact?: boolean }) {
  return (
    <div className={`empty-state ${horizontal ? "horizontal" : ""} ${compact ? "compact" : ""}`}>
      <span className="empty-glyph" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

export function ErrorNotice({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <p className={`inline-error ${compact ? "compact" : ""}`} role="alert" aria-live="assertive">
      {message}
    </p>
  );
}

export function StatusRow({ label, value, tone }: { label: string; value: string; tone: UiTone }) {
  return (
    <div className={`status-row tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: UiTone }) {
  return (
    <div className={`metric-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export async function copyToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();

  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) throw new Error("Clipboard copy is not available in this browser.");
}
