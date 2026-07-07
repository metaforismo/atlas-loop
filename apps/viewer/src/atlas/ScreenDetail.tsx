import { screenDisplayName, screenImageUrl, type AtlasScreenLike, type AtlasTransitionLike, type OpenSessionHandler } from "./atlasApi.js";
import { formatDateTime } from "../viewerPresentation.js";

export function ScreenDetail({
  daemonUrl,
  screen,
  transitions,
  screens,
  onSelectScreen,
  onOpenSession,
  onClose
}: {
  daemonUrl: string;
  screen: AtlasScreenLike;
  transitions: AtlasTransitionLike[];
  screens: AtlasScreenLike[];
  onSelectScreen: (screenId: string) => void;
  onOpenSession: OpenSessionHandler;
  onClose: () => void;
}) {
  const inbound = transitions.filter((transition) => transition.to === screen.id);
  const outbound = transitions.filter((transition) => transition.from === screen.id);

  const nameFor = (nodeId: string): string => {
    if (nodeId === "__launch__") return "launch";
    const target = screens.find((candidate) => candidate.id === nodeId);
    return target ? screenDisplayName(target) : nodeId;
  };

  return (
    <aside className="atlas-detail" aria-label={`Screen details for ${screenDisplayName(screen)}`}>
      <div className="panel-title-row">
        <h2>{screenDisplayName(screen)}</h2>
        <button type="button" onClick={onClose} aria-label="Close screen details">
          ✕
        </button>
      </div>

      <img className="atlas-detail-image" src={screenImageUrl(daemonUrl, screen.id)} alt={`Representative screenshot of ${screenDisplayName(screen)}`} />

      <dl className="atlas-detail-facts">
        <div>
          <dt>Screenshots</dt>
          <dd>{screen.screenshotCount}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>{screen.sessionIds.length}</dd>
        </div>
        <div>
          <dt>First seen</dt>
          <dd>{formatDateTime(screen.firstSeenAt)}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>{formatDateTime(screen.lastSeenAt)}</dd>
        </div>
      </dl>

      {screen.variants.length > 1 ? (
        <div className="atlas-detail-variants" aria-label="Screen variants">
          {screen.variants.map((variant, index) => (
            <button
              key={`${variant.artifactId}:${index}`}
              type="button"
              className="atlas-variant-link"
              onClick={() => onOpenSession(variant.sessionId, { artifactId: variant.artifactId })}
              aria-label={`Open variant ${index + 1} in session ${variant.sessionId}`}
              title={`Open ${variant.artifactId} in session ${variant.sessionId}`}
            >
              <img src={screenImageUrl(daemonUrl, screen.id, index)} alt={`Variant ${index + 1}`} loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}

      <TransitionList title="Arrives from" transitions={inbound} pick={(transition) => transition.from} nameFor={nameFor} onSelectScreen={onSelectScreen} onOpenSession={onOpenSession} />
      <TransitionList title="Leads to" transitions={outbound} pick={(transition) => transition.to} nameFor={nameFor} onSelectScreen={onSelectScreen} onOpenSession={onOpenSession} />

      <div className="atlas-detail-sessions">
        <strong>Observed in</strong>
        <ul>
          {screen.sessionIds.map((sessionId) => (
            <li key={sessionId}>
              <button type="button" onClick={() => onOpenSession(sessionId)} aria-label={`Open session ${sessionId} in the sessions view`}>
                {sessionId}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function TransitionList({
  title,
  transitions,
  pick,
  nameFor,
  onSelectScreen,
  onOpenSession
}: {
  title: string;
  transitions: AtlasTransitionLike[];
  pick: (transition: AtlasTransitionLike) => string;
  nameFor: (nodeId: string) => string;
  onSelectScreen: (screenId: string) => void;
  onOpenSession: OpenSessionHandler;
}) {
  return (
    <div className="atlas-detail-transitions">
      <strong>{title}</strong>
      {transitions.length === 0 ? (
        <p>None observed.</p>
      ) : (
        <ul>
          {transitions.map((transition) => {
            const nodeId = pick(transition);
            const example = transition.examples?.[0];
            return (
              <li key={transition.id}>
                {nodeId === "__launch__" ? (
                  <span>launch</span>
                ) : (
                  <button type="button" onClick={() => onSelectScreen(nodeId)}>
                    {nameFor(nodeId)}
                  </button>
                )}
                <code>{transition.actionSignature}</code>
                <small>×{transition.count}</small>
                {example ? (
                  <button
                    type="button"
                    className="atlas-transition-example"
                    onClick={() => onOpenSession(example.sessionId, { actionId: example.actionId })}
                    aria-label={`Open example of ${transition.actionSignature} in session ${example.sessionId}`}
                    title={`Open action ${example.actionId} in session ${example.sessionId}`}
                  >
                    example
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
