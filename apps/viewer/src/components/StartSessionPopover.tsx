import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createViewerSession } from "../api.js";
import type { InputBackendKind, Session } from "../types.js";

export function StartSessionPopover({
  daemonUrl,
  disabled,
  disabledReason,
  onStarted,
  openRequest,
  requestedBundleId
}: {
  daemonUrl: string;
  disabled: boolean;
  disabledReason: string;
  onStarted: (session: Session) => void;
  openRequest?: number;
  requestedBundleId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [simulatorName, setSimulatorName] = useState("");
  const [bundleId, setBundleId] = useState("app.atlasloop.CommerceDemo");
  const [inputBackend, setInputBackend] = useState<InputBackendKind>("xcuitest");
  const [record, setRecord] = useState(true);
  const [status, setStatus] = useState<"idle" | "starting" | "error">("idle");
  const [message, setMessage] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const close = (): void => {
    requestRef.current?.abort();
    requestRef.current = null;
    setStatus("idle");
    setMessage("");
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        buttonRef.current?.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node) || buttonRef.current?.contains(event.target as Node)) return;
      close();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!openRequest) return;
    const nextBundleId = requestedBundleId?.trim();
    if (nextBundleId) setBundleId(nextBundleId);
    setOpen(true);
  }, [openRequest, requestedBundleId]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (disabled || status === "starting") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("starting");
    setMessage("Creating a local Simulator session…");
    try {
      const session = await createViewerSession(daemonUrl, { simulatorName, bundleId, inputBackend, record }, controller.signal);
      if (requestRef.current !== controller) return;
      setStatus("idle");
      setMessage("");
      setOpen(false);
      onStarted(session);
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not start the session.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  };

  return (
    <div className="start-session-control">
      <button
        ref={buttonRef}
        type="button"
        className="start-session-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={disabled ? disabledReason : "Create a new local Simulator session"}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">＋</span> Start session
      </button>
      {open ? (
        <div ref={panelRef} className="start-session-popover" role="dialog" aria-label="Start local Simulator session">
          <div className="start-session-heading">
            <div><small>LOCAL RUNTIME</small><h2>Start session</h2></div>
            <button type="button" aria-label="Close session launcher" onClick={close}>×</button>
          </div>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              <span>Platform</span>
              <input value="iOS Simulator" disabled />
            </label>
            <label>
              <span>Device</span>
              <input
                ref={firstFieldRef}
                value={simulatorName}
                onChange={(event) => setSimulatorName(event.target.value)}
                placeholder="Auto-select booted Simulator"
                spellCheck={false}
              />
              <small>Leave blank to use the booted device.</small>
            </label>
            <label>
              <span>Gesture backend</span>
              <select value={inputBackend} onChange={(event) => setInputBackend(event.target.value as InputBackendKind)}>
                <option value="xcuitest">XCUITest · multi-gesture</option>
                <option value="cgevent">Core Graphics · fast input</option>
              </select>
            </label>
            <label>
              <span>App bundle ID</span>
              <input
                value={bundleId}
                onChange={(event) => setBundleId(event.target.value)}
                placeholder="app.example.YourApp"
                spellCheck={false}
                required={inputBackend === "xcuitest"}
              />
              <small>{inputBackend === "xcuitest" ? "Required: Atlas Loop launches this installed app before gestures." : "Optional: launch an installed app with the session."}</small>
            </label>
            <label className="start-session-checkbox">
              <input type="checkbox" checked={record} onChange={(event) => setRecord(event.target.checked)} />
              <span>Record replayable video evidence</span>
            </label>
            <div className="start-session-note">
              <strong>Runtime overrides</strong>
              <span>Viewer link, artifact storage, and action history are configured automatically.</span>
            </div>
            {message ? <p className={`start-session-message ${status}`} role="status">{message}</p> : null}
            <button type="submit" className="start-session-submit" disabled={disabled || status === "starting"}>
              {status === "starting" ? "Starting…" : disabled ? "Daemon offline" : "Start local session"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
