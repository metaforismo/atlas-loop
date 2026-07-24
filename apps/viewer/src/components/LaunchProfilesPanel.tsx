import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  FileSearchIcon,
  Rocket01Icon,
  Search01Icon,
  ShieldKeyIcon
} from "@hugeicons/core-free-icons";
import { deleteLaunchProfile, loadSavedLaunchProfiles, saveLaunchProfile } from "../localLaunchProfileStorage.js";
import {
  LOCAL_LAUNCH_PROFILE_STARTERS,
  compileLaunchProfileDraft,
  type LocalLaunchProfile,
  type LocalLaunchProfileDraft
} from "../localLaunchProfiles.js";
import { useModalDialog } from "../useModalDialog.js";
import { ProductIcon } from "./ProductIcon.js";

type ProfileSource = "saved" | "starter";
type ProfileScope = "all" | "saved" | "starters";

interface ProfileEntry extends LocalLaunchProfile {
  key: string;
  source: ProfileSource;
}

export function LaunchProfilesPanel({
  onStart,
  openComposerRequest,
  onCountChange
}: {
  onStart: (profile: LocalLaunchProfile) => void;
  openComposerRequest: number;
  onCountChange: (count: number) => void;
}) {
  const [saved, setSaved] = useState<LocalLaunchProfile[]>(() => loadSavedLaunchProfiles());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ProfileScope>("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [message, setMessage] = useState("");
  const deferredQuery = useDeferredValue(query);
  const entries = useMemo(() => buildProfileEntries(saved), [saved]);
  const visibleEntries = useMemo(() => filterProfiles(entries, deferredQuery, scope), [entries, deferredQuery, scope]);
  const selected = visibleEntries.find((entry) => entry.key === selectedKey) ?? visibleEntries[0];
  const environmentCount = entries.reduce((total, profile) => total + Object.keys(profile.environment).length, 0);
  const argumentCount = entries.reduce((total, profile) => total + profile.arguments.length, 0);
  const hasFilters = Boolean(query.trim()) || scope !== "all";

  useEffect(() => {
    if (openComposerRequest > 0) setComposerOpen(true);
  }, [openComposerRequest]);

  useEffect(() => onCountChange(entries.length), [entries.length, onCountChange]);

  useEffect(() => {
    if (!selected) {
      setSelectedKey("");
      return;
    }
    if (selected.key !== selectedKey) setSelectedKey(selected.key);
  }, [selected, selectedKey]);

  const persist = (profile: LocalLaunchProfile, confirmation: string): void => {
    try {
      setSaved(saveLaunchProfile(profile));
      setSelectedKey(`saved:${profile.id}`);
      setScope("saved");
      setMessage(confirmation);
    } catch {
      setMessage("This browser blocked local launch-profile storage. Check its site-data permissions.");
    }
  };

  const duplicate = (profile: ProfileEntry): void => {
    const now = new Date().toISOString();
    const copy: LocalLaunchProfile = {
      ...profile,
      id: createLocalLaunchProfileId(),
      label: `${profile.label} copy`.slice(0, 80),
      arguments: [...profile.arguments],
      environment: { ...profile.environment },
      createdAt: now,
      updatedAt: now
    };
    persist(copy, `${copy.label} saved in this browser.`);
  };

  const remove = (profile: ProfileEntry): void => {
    if (profile.source !== "saved") return;
    try {
      setSaved(deleteLaunchProfile(profile.id));
      setSelectedKey("");
      setPendingDeleteId(undefined);
      setMessage(`${profile.label} removed. Existing sessions and evidence are unchanged.`);
    } catch {
      setMessage("This browser could not remove the saved launch profile.");
    }
  };

  const clearFilters = (): void => {
    setQuery("");
    setScope("all");
  };

  return (
    <div id="library-launch-profiles" role="tabpanel" aria-label="Launch profiles">
      <div className="library-metrics" aria-label="Local launch-profile metrics">
        <LibraryMetric label="Total profiles" value={String(entries.length)} detail="Saved and built-in" />
        <LibraryMetric label="Saved locally" value={String(saved.length)} detail="Stored in this browser" />
        <LibraryMetric label="Environment" value={String(environmentCount)} detail="Non-secret values" />
        <LibraryMetric label="Arguments" value={String(argumentCount)} detail="Exact launch order" tone={argumentCount ? "good" : "neutral"} />
      </div>

      <div className="library-principle launch-profile-principle">
        <ProductIcon icon={ShieldKeyIcon} size={18} />
        <div><small>Local, not secret</small><strong>Profiles make startup deterministic without becoming a credential store.</strong><span>Secret-like keys are blocked before save. Pass credentials through the shell or your existing secret manager.</span></div>
        <button type="button" onClick={() => selected && onStart(selected)} disabled={!selected}>Start with selected<ProductIcon icon={ArrowRight01Icon} size={14} /></button>
      </div>

      <div className="library-controls launch-profile-controls" role="search" aria-label="Filter launch profiles">
        <label className="library-search"><ProductIcon icon={Search01Icon} size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search profile, bundle, argument, or environment…" aria-label="Search launch profiles" /></label>
        <div className="library-scopes" role="group" aria-label="Launch profile source filter">
          {(["all", "saved", "starters"] as ProfileScope[]).map((option) => <button type="button" key={option} aria-pressed={scope === option} onClick={() => setScope(option)}>{option === "all" ? "All" : option === "saved" ? "Saved" : "Starters"}</button>)}
        </div>
      </div>

      <div className="library-result-bar" role="status">
        <span>{visibleEntries.length} of {entries.length} profiles</span>
        {hasFilters ? <button type="button" onClick={clearFilters}>Clear filters</button> : <small>Values stay on this device</small>}
      </div>

      {visibleEntries.length === 0 ? (
        <div className="library-empty"><ProductIcon icon={FileSearchIcon} size={28} /><strong>No launch profiles match</strong><p>Clear the current query or source filter to return to every available profile.</p><button type="button" onClick={clearFilters}>Clear filters</button></div>
      ) : (
        <div className="library-grid">
          <section className="library-catalog launch-profile-catalog" aria-label="Available launch profiles">
            <div className="library-catalog-head"><span>Profile</span><span>Values</span><span>Source</span></div>
            <div className="library-catalog-list" role="listbox" aria-label="Local launch profiles">
              {visibleEntries.map((profile) => {
                const valueCount = profile.arguments.length + Object.keys(profile.environment).length;
                return (
                  <button type="button" role="option" aria-selected={selected?.key === profile.key} className={selected?.key === profile.key ? "selected" : ""} key={profile.key} onClick={() => setSelectedKey(profile.key)}>
                    <span><strong>{profile.label}</strong><small>{profile.detail}</small><em>{profile.bundleId}</em></span>
                    <span className="library-step-count">{valueCount}<small>overrides</small></span>
                    <span className="library-source-badge">{profile.source}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {selected ? (
            <aside className="library-detail launch-profile-detail" aria-labelledby="launch-profile-detail-title">
              <header><div><p className="kicker">{selected.source === "saved" ? "Saved in this browser" : "Atlas Loop starter"}</p><h2 id="launch-profile-detail-title">{selected.label}</h2></div><span>{selected.arguments.length + Object.keys(selected.environment).length} overrides</span></header>
              <p className="library-detail-copy">{selected.detail}</p>
              <dl className="launch-profile-facts"><div><dt>Bundle ID</dt><dd>{selected.bundleId}</dd></div><div><dt>Arguments</dt><dd>{selected.arguments.length}</dd></div><div><dt>Environment</dt><dd>{Object.keys(selected.environment).length}</dd></div></dl>
              <LaunchValues profile={selected} />
              <div className="library-detail-actions launch-profile-actions">
                <button type="button" className="library-use" onClick={() => onStart(selected)}><ProductIcon icon={Rocket01Icon} />Start with profile<ProductIcon icon={ArrowRight01Icon} size={14} /></button>
                <button type="button" onClick={() => duplicate(selected)}><ProductIcon icon={Copy01Icon} />{selected.source === "starter" ? "Save a copy" : "Duplicate"}</button>
                {selected.source === "saved" ? <button type="button" className="library-delete" onClick={() => setPendingDeleteId(selected.id)}><ProductIcon icon={Delete02Icon} />Delete</button> : null}
              </div>
              {pendingDeleteId === selected.id ? <div className="library-delete-confirm" role="alert"><span>Remove “{selected.label}”? Existing sessions and evidence stay intact.</span><button type="button" onClick={() => remove(selected)}>Remove</button><button type="button" onClick={() => setPendingDeleteId(undefined)}>Keep</button></div> : null}
              <p className="library-message" role="status" aria-live="polite">{message}</p>
            </aside>
          ) : null}
        </div>
      )}

      {composerOpen ? <LaunchProfileComposer onClose={() => setComposerOpen(false)} onSaved={(profile) => { persist(profile, `${profile.label} saved in this browser.`); setComposerOpen(false); }} /> : null}
    </div>
  );
}

function LaunchValues({ profile }: { profile: LocalLaunchProfile }) {
  const environment = Object.entries(profile.environment);
  if (!profile.arguments.length && !environment.length) return <div className="launch-profile-empty-values"><strong>No overrides</strong><span>The installed app launches with its default process state.</span></div>;
  return (
    <div className="launch-profile-values">
      {profile.arguments.length ? <section><h3>Launch arguments</h3>{profile.arguments.map((argument, index) => <code key={`${argument}-${index}`}>{argument}</code>)}</section> : null}
      {environment.length ? <section><h3>Environment</h3>{environment.map(([key, value]) => <code key={key}><b>{key}</b><span>=</span>{value || <em>empty</em>}</code>)}</section> : null}
    </div>
  );
}

function LaunchProfileComposer({ onClose, onSaved }: { onClose: () => void; onSaved: (profile: LocalLaunchProfile) => void }) {
  const [draft, setDraft] = useState<LocalLaunchProfileDraft>({ label: "", detail: "", bundleId: "app.atlasloop.CommerceDemo", argumentsSource: "", environmentSource: "ATLAS_LOOP_DEMO_ROUTE=gesture-lab" });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const compiled = useMemo(() => compileLaunchProfileDraft(draft), [draft]);
  const dirty = Boolean(draft.label || draft.detail || draft.argumentsSource || draft.environmentSource !== "ATLAS_LOOP_DEMO_ROUTE=gesture-lab" || draft.bundleId !== "app.atlasloop.CommerceDemo");
  const requestClose = (): void => {
    if (!dirty || confirmDiscard) {
      onClose();
      return;
    }
    setConfirmDiscard(true);
  };
  const { dialogRef } = useModalDialog(requestClose);
  const update = <K extends keyof LocalLaunchProfileDraft>(key: K, value: LocalLaunchProfileDraft[K]): void => setDraft((current) => ({ ...current, [key]: value }));
  const fieldError = (field: keyof LocalLaunchProfileDraft): string => compiled.errors.find((error) => error.field === (field === "argumentsSource" ? "arguments" : field === "environmentSource" ? "environment" : field))?.message ?? "";
  const save = (): void => {
    if (compiled.errors.length) return;
    const now = new Date().toISOString();
    onSaved({
      id: createLocalLaunchProfileId(),
      label: draft.label.trim(),
      detail: draft.detail.trim() || "Deterministic local app startup configuration.",
      bundleId: draft.bundleId.trim(),
      arguments: compiled.arguments,
      environment: compiled.environment,
      createdAt: now,
      updatedAt: now
    });
  };

  return (
    <div className="library-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={dialogRef} className="library-composer launch-profile-composer" role="dialog" aria-modal="true" aria-labelledby="launch-profile-composer-title" tabIndex={-1}>
        <header><div><p className="kicker">Deterministic app startup</p><h2 id="launch-profile-composer-title">Create launch profile</h2><span>Arguments and non-secret environment values are sent exactly once when the installed app launches.</span></div><button type="button" aria-label="Close launch profile composer" onClick={requestClose}><ProductIcon icon={Cancel01Icon} /></button></header>
        <div className="library-composer-body">
          <div className="library-composer-fields">
            <label><span>Profile name</span><input autoFocus value={draft.label} onChange={(event) => update("label", event.target.value)} placeholder="Gesture Lab ready" aria-invalid={Boolean(fieldError("label"))} />{fieldError("label") ? <small className="library-field-error">{fieldError("label")}</small> : <small>Shown in the local launch catalog.</small>}</label>
            <label><span>Description</span><textarea className="library-description-field" value={draft.detail} onChange={(event) => update("detail", event.target.value)} placeholder="What startup state this profile prepares." aria-invalid={Boolean(fieldError("detail"))} />{fieldError("detail") ? <small className="library-field-error">{fieldError("detail")}</small> : <small>Describe the state a tester should expect after launch.</small>}</label>
            <label><span>App bundle ID</span><input value={draft.bundleId} onChange={(event) => update("bundleId", event.target.value)} placeholder="app.example.YourApp" spellCheck={false} aria-invalid={Boolean(fieldError("bundleId"))} />{fieldError("bundleId") ? <small className="library-field-error">{fieldError("bundleId")}</small> : <small>The app must already be installed on the target Simulator.</small>}</label>
            <label><span>Launch arguments</span><textarea className="launch-profile-source-field" value={draft.argumentsSource} onChange={(event) => update("argumentsSource", event.target.value)} aria-label="Launch arguments" placeholder={'--uitesting\n--atlas-demo-route=gesture-lab'} spellCheck={false} aria-invalid={Boolean(fieldError("argumentsSource"))} /><small className={fieldError("argumentsSource") ? "library-field-error" : ""}>{fieldError("argumentsSource") || "One exact process argument per line; blank and # comment lines are ignored."}</small></label>
            <label><span>Environment</span><textarea className="launch-profile-source-field" value={draft.environmentSource} onChange={(event) => update("environmentSource", event.target.value)} aria-label="Launch environment" placeholder="ATLAS_LOOP_DEMO_ROUTE=gesture-lab" spellCheck={false} aria-invalid={Boolean(fieldError("environmentSource"))} /><small className={fieldError("environmentSource") ? "library-field-error" : ""}>{fieldError("environmentSource") || "One KEY=VALUE pair per line. Secret-like keys are blocked from browser storage."}</small></label>
          </div>
          <div className="library-compile-preview launch-profile-preview">
            <header><div><span>Launch preview</span><strong>{compiled.errors.length ? `${compiled.errors.length} issue${compiled.errors.length === 1 ? "" : "s"}` : `${compiled.arguments.length + Object.keys(compiled.environment).length} overrides ready`}</strong></div><em className={compiled.errors.length ? "bad" : "good"}>{compiled.errors.length ? "Fix profile" : "Valid"}</em></header>
            {compiled.errors.length ? <div className="library-compile-errors">{compiled.errors.map((error, index) => <div key={`${error.field}-${error.line ?? 0}-${index}`}><span>{error.field.toUpperCase()}{error.line ? ` · LINE ${error.line}` : ""}</span><strong>{error.message}</strong></div>)}</div> : <><div className="launch-profile-preview-bundle"><small>INSTALLED APP</small><strong>{draft.bundleId.trim()}</strong></div><LaunchValues profile={{ id: "preview", label: draft.label, detail: draft.detail, bundleId: draft.bundleId, arguments: compiled.arguments, environment: compiled.environment }} /><div className="launch-profile-security-note"><ProductIcon icon={ShieldKeyIcon} /><span><strong>Safe storage boundary</strong><small>This profile stays in browser storage and contains no secret-like environment keys.</small></span></div></>}
          </div>
        </div>
        <footer>{confirmDiscard ? <div className="launch-profile-discard" role="alert"><strong>Discard this draft?</strong><button type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button type="button" onClick={onClose}>Discard</button></div> : <><span>{compiled.errors.length ? "Resolve the highlighted profile issues." : "Ready to save locally."}</span><button type="button" onClick={requestClose}>Cancel</button><button type="button" className="library-composer-save" disabled={compiled.errors.length > 0} onClick={save}><ProductIcon icon={Rocket01Icon} />Save profile</button></>}</footer>
      </div>
    </div>
  );
}

function buildProfileEntries(saved: LocalLaunchProfile[]): ProfileEntry[] {
  return [...saved.map((profile) => toProfileEntry(profile, "saved")), ...LOCAL_LAUNCH_PROFILE_STARTERS.map((profile) => toProfileEntry(profile, "starter"))];
}

function toProfileEntry(profile: LocalLaunchProfile, source: ProfileSource): ProfileEntry {
  return { ...profile, key: `${source}:${profile.id}`, source };
}

function filterProfiles(entries: ProfileEntry[], query: string, scope: ProfileScope): ProfileEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((profile) => {
    if (scope === "saved" && profile.source !== "saved") return false;
    if (scope === "starters" && profile.source !== "starter") return false;
    if (!terms.length) return true;
    const haystack = [profile.label, profile.detail, profile.bundleId, ...profile.arguments, ...Object.entries(profile.environment).flat()].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  }).sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || (left.source === right.source ? left.label.localeCompare(right.label) : left.source === "saved" ? -1 : 1));
}

function createLocalLaunchProfileId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `launch-${crypto.randomUUID()}` : `launch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function LibraryMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" }) {
  return <div className={`library-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
