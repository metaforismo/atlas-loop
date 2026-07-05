import { screenDisplayName, screenImageUrl, type AtlasScreenLike } from "./atlasApi.js";
import { formatDateTime } from "../viewerPresentation.js";

export function ScreensGrid({
  daemonUrl,
  screens,
  loading,
  selectedScreenId,
  onSelect
}: {
  daemonUrl: string;
  screens: AtlasScreenLike[];
  loading: boolean;
  selectedScreenId?: string;
  onSelect: (screenId: string) => void;
}) {
  if (loading) {
    return (
      <div className="atlas-grid-empty" role="status" aria-live="polite">
        Deriving the atlas map from local session evidence...
      </div>
    );
  }

  if (screens.length === 0) {
    return (
      <div className="atlas-grid-empty" role="status">
        No screens derived yet. Run sessions with screenshots (or a checkout smoke) and rebuild the map.
      </div>
    );
  }

  return (
    <div className="atlas-grid" role="list" aria-label="Observed screens">
      {screens.map((screen) => (
        <button
          key={screen.id}
          type="button"
          role="listitem"
          className={`atlas-screen-card ${screen.id === selectedScreenId ? "selected" : ""}`}
          onClick={() => onSelect(screen.id)}
          aria-label={`Open screen ${screenDisplayName(screen)}`}
        >
          <img src={screenImageUrl(daemonUrl, screen.id)} alt="" loading="lazy" />
          <span className="atlas-screen-name" title={screen.screenId ?? screen.id}>
            {screenDisplayName(screen)}
          </span>
          <span className="atlas-screen-meta">
            {screen.screenshotCount} shot{screen.screenshotCount === 1 ? "" : "s"} · {screen.sessionIds.length} session
            {screen.sessionIds.length === 1 ? "" : "s"}
          </span>
          <span className="atlas-screen-meta">last seen {formatDateTime(screen.lastSeenAt)}</span>
        </button>
      ))}
    </div>
  );
}
