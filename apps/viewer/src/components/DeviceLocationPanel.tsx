import { useState } from "react";
import { LOCATION_PRESETS, parseDeviceLocation } from "@atlas-loop/protocol";
import { setViewerLocation } from "../api.js";
import type { ViewerParams } from "../types.js";
import type { ActionMutationState } from "./ActionPanel.js";

type LocationState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "applied"; label: string }
  | { status: "failed"; message: string };

/**
 * Places the device somewhere. Regional business logic is otherwise only ever
 * exercised wherever the host machine happens to be, which is how locale bugs
 * survive releases.
 */
export function DeviceLocationPanel({
  params,
  selectedSessionId,
  mutationState
}: {
  params: ViewerParams;
  selectedSessionId: string;
  mutationState: ActionMutationState;
}) {
  const [presetId, setPresetId] = useState(LOCATION_PRESETS[0]!.id);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [state, setState] = useState<LocationState>({ status: "idle" });

  const pending = state.status === "pending";
  const disabled = pending || !mutationState.canSubmitActions;
  const usingCustom = latitude.trim() !== "" || longitude.trim() !== "";
  const custom = usingCustom ? parseDeviceLocation(latitude, longitude) : undefined;
  const preset = LOCATION_PRESETS.find((candidate) => candidate.id === presetId)!;

  const apply = (): void => {
    const location = custom ? custom.location : { latitude: preset.latitude, longitude: preset.longitude };
    if (!location) return;

    setState({ status: "pending" });
    void setViewerLocation({ ...params, sessionId: selectedSessionId }, {
      location,
      presetId: custom ? undefined : preset.id
    })
      .then(() => setState({ status: "applied", label: custom ? `${location.latitude}, ${location.longitude}` : preset.label }))
      .catch((error: unknown) => setState({ status: "failed", message: error instanceof Error ? error.message : "Could not set the location." }));
  };

  const clear = (): void => {
    setState({ status: "pending" });
    void setViewerLocation({ ...params, sessionId: selectedSessionId }, {})
      .then(() => {
        setLatitude("");
        setLongitude("");
        setState({ status: "applied", label: "device default" });
      })
      .catch((error: unknown) => setState({ status: "failed", message: error instanceof Error ? error.message : "Could not clear the location." }));
  };

  return (
    <section className="device-location" aria-labelledby="device-location-title">
      <div className="panel-title-row">
        <h2 id="device-location-title">Device location</h2>
        <span>{usingCustom ? "custom" : "preset"}</span>
      </div>

      <label className="device-location-preset">
        <span className="sr-only">Location preset</span>
        <select value={presetId} disabled={usingCustom || disabled} onChange={(event) => setPresetId(event.target.value)}>
          {LOCATION_PRESETS.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label} — {candidate.detail}
            </option>
          ))}
        </select>
      </label>

      <div className="device-location-coords">
        <label>
          <span>Latitude</span>
          <input
            value={latitude}
            inputMode="decimal"
            spellCheck={false}
            placeholder={preset.latitude.toFixed(6)}
            disabled={disabled}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </label>
        <label>
          <span>Longitude</span>
          <input
            value={longitude}
            inputMode="decimal"
            spellCheck={false}
            placeholder={preset.longitude.toFixed(6)}
            disabled={disabled}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </label>
      </div>

      {/* Both axes are reported together rather than one at a time. */}
      {custom && custom.errors.length > 0 ? (
        <ul className="device-location-errors" role="alert">
          {custom.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <div className="device-location-actions">
        <button type="button" disabled={disabled || (custom ? custom.errors.length > 0 : false)} onClick={apply}>
          {pending ? "Applying…" : "Set location"}
        </button>
        <button type="button" className="device-location-clear" disabled={disabled} onClick={clear}>
          Clear
        </button>
      </div>

      <p className={`device-location-status ${state.status}`} role="status" aria-live="polite">
        {state.status === "failed"
          ? state.message
          : state.status === "applied"
            ? `Device placed at ${state.label}.`
            : mutationState.canSubmitActions
              ? "Recorded with the run, so evidence states where it thought it was."
              : mutationState.detail}
      </p>
    </section>
  );
}
