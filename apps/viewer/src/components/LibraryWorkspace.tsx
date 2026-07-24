import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  Add01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  FileSearchIcon,
  Search01Icon
} from "@hugeicons/core-free-icons";
import { deleteLocalTestModule, loadSavedLocalTestModules, saveLocalTestModule } from "../localTestModuleStorage.js";
import {
  DEFAULT_LOCAL_TEST_MODULE_SCRIPT,
  LOCAL_TEST_MODULE_STARTERS,
  localTestModuleUsesMultiTouch,
  type LocalTestModule,
  type LocalTestModuleSeed
} from "../localTestModules.js";
import { compileLocalTestScript } from "../localTests.js";
import { useModalDialog } from "../useModalDialog.js";
import { loadSavedLaunchProfiles } from "../localLaunchProfileStorage.js";
import { LOCAL_LAUNCH_PROFILE_STARTERS, type LocalLaunchProfile } from "../localLaunchProfiles.js";
import { LaunchProfilesPanel } from "./LaunchProfilesPanel.js";
import { ProductIcon } from "./ProductIcon.js";

type ModuleSource = "saved" | "starter";
type ModuleScope = "all" | "saved" | "starters" | "multitouch";
type ModuleSort = "recent" | "name" | "steps";
type LibraryTab = "modules" | "launch-profiles";

interface ModuleEntry extends LocalTestModule {
  key: string;
  source: ModuleSource;
  multitouch: boolean;
}

const MODULE_SCOPES: Array<{ id: ModuleScope; label: string }> = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "starters", label: "Starters" },
  { id: "multitouch", label: "Multi-touch" }
];

export function LibraryWorkspace({
  onCreateTest,
  onStartWithProfile
}: {
  onCreateTest: (seed: LocalTestModuleSeed) => void;
  onStartWithProfile: (profile: LocalLaunchProfile) => void;
}) {
  const [activeTab, setActiveTab] = useState<LibraryTab>("modules");
  const [launchProfileCount, setLaunchProfileCount] = useState(() => loadSavedLaunchProfiles().length + LOCAL_LAUNCH_PROFILE_STARTERS.length);
  const [saved, setSaved] = useState<LocalTestModule[]>(() => loadSavedLocalTestModules());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ModuleScope>("all");
  const [sort, setSort] = useState<ModuleSort>("recent");
  const [selectedKey, setSelectedKey] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [launchComposerRequest, setLaunchComposerRequest] = useState(0);
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [message, setMessage] = useState("");
  const deferredQuery = useDeferredValue(query);
  const entries = useMemo(() => buildModuleEntries(saved), [saved]);
  const visibleEntries = useMemo(() => filterModules(entries, deferredQuery, scope, sort), [entries, deferredQuery, scope, sort]);
  const selected = visibleEntries.find((entry) => entry.key === selectedKey) ?? visibleEntries[0];
  const totalSteps = entries.reduce((total, entry) => total + entry.steps.length, 0);
  const multitouchCount = entries.filter((entry) => entry.multitouch).length;
  const hasFilters = query.trim().length > 0 || scope !== "all" || sort !== "recent";

  useEffect(() => {
    if (!selected) {
      setSelectedKey("");
      return;
    }
    if (selected.key !== selectedKey) setSelectedKey(selected.key);
  }, [selected, selectedKey]);

  const persistModule = (module: LocalTestModule, confirmation: string): void => {
    try {
      setSaved(saveLocalTestModule(module));
      setSelectedKey(`saved:${module.id}`);
      setScope("saved");
      setMessage(confirmation);
    } catch {
      setMessage("This browser blocked local module storage. Check its site-data permissions.");
    }
  };

  const duplicateModule = (module: ModuleEntry): void => {
    const now = new Date().toISOString();
    const copy: LocalTestModule = {
      ...module,
      id: createLocalModuleId(),
      label: `${module.label} copy`,
      tags: [...module.tags],
      steps: module.steps.map((step) => ({ ...step, action: structuredClone(step.action) })),
      createdAt: now,
      updatedAt: now
    };
    persistModule(copy, `${copy.label} saved in this browser.`);
  };

  const removeModule = (module: ModuleEntry): void => {
    if (module.source !== "saved") return;
    try {
      setSaved(deleteLocalTestModule(module.id));
      setSelectedKey("");
      setPendingDeleteId(undefined);
      setMessage(`${module.label} removed. Tests that already include its readable steps are unchanged.`);
    } catch {
      setMessage("This browser could not remove the saved module.");
    }
  };

  const resetFilters = (): void => {
    setQuery("");
    setScope("all");
    setSort("recent");
  };

  return (
    <section id="library-workspace" className="library-workspace" aria-labelledby="library-workspace-title" tabIndex={-1}>
      <header className="library-workspace-header">
        <div>
          <p className="kicker">Reusable local building blocks</p>
          <h1 id="library-workspace-title">Library</h1>
          <p>{activeTab === "modules" ? "Keep proven step blocks reusable without hiding what will run. Modules stay readable, browser-local, and compile through the same deterministic action protocol as Tests." : "Save deterministic, non-secret startup state for installed apps. Profiles preserve exact arguments and environment values, then hand them to the local session launcher."}</p>
        </div>
        <button type="button" className="library-primary-action" onClick={() => activeTab === "modules" ? setComposerOpen(true) : setLaunchComposerRequest((request) => request + 1)}><ProductIcon icon={Add01Icon} />{activeTab === "modules" ? "New module" : "New launch profile"}</button>
      </header>

      <div className="library-resource-tabs" role="tablist" aria-label="Library resource types">
        <button type="button" role="tab" aria-selected={activeTab === "modules"} aria-controls="library-step-modules" onClick={() => setActiveTab("modules")}><span>Step modules</span><small>{entries.length}</small></button>
        <button type="button" role="tab" aria-selected={activeTab === "launch-profiles"} aria-controls="library-launch-profiles" onClick={() => setActiveTab("launch-profiles")}><span>Launch profiles</span><small>{launchProfileCount}</small></button>
      </div>

      {activeTab === "modules" ? <div id="library-step-modules" role="tabpanel" aria-label="Step modules">
      <div className="library-metrics" aria-label="Local module metrics">
        <LibraryMetric label="Total modules" value={String(entries.length)} detail="Saved and built-in" />
        <LibraryMetric label="Saved locally" value={String(saved.length)} detail="Stored in this browser" />
        <LibraryMetric label="Reusable steps" value={String(totalSteps)} detail="Exact compiled actions" />
        <LibraryMetric label="Multi-touch" value={String(multitouchCount)} detail="XCUITest-aware modules" tone={multitouchCount ? "good" : "neutral"} />
      </div>

      <div className="library-principle">
        <ProductIcon icon={BookOpen01Icon} size={18} />
        <div><small>Visible composition</small><strong>Using a module inserts its readable commands into the test.</strong><span>There are no hidden remote references, so the saved test remains inspectable and portable.</span></div>
        <button type="button" onClick={() => selected && createTestFromModule(selected, onCreateTest)} disabled={!selected}>Use selected module<ProductIcon icon={ArrowRight01Icon} size={14} /></button>
      </div>

      <div className="library-controls" role="search" aria-label="Filter local modules">
        <label className="library-search"><ProductIcon icon={Search01Icon} size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search module, tag, command, or action…" aria-label="Search local modules" /></label>
        <div className="library-scopes" role="group" aria-label="Module source filter">
          {MODULE_SCOPES.map((option) => <button type="button" key={option.id} aria-pressed={scope === option.id} onClick={() => setScope(option.id)}>{option.label}</button>)}
        </div>
        <label className="library-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as ModuleSort)} aria-label="Sort local modules"><option value="recent">Recently saved</option><option value="name">Name</option><option value="steps">Most steps</option></select></label>
      </div>

      <div className="library-result-bar" role="status">
        <span>{visibleEntries.length} of {entries.length} modules</span>
        {hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : <small>Definitions stay on this device</small>}
      </div>

      {visibleEntries.length === 0 ? (
        <div className="library-empty"><ProductIcon icon={FileSearchIcon} size={28} /><strong>No modules match</strong><p>Clear the current query or source filter to return to the complete local library.</p><button type="button" onClick={resetFilters}>Clear filters</button></div>
      ) : (
        <div className="library-grid">
          <section className="library-catalog" aria-label="Available local modules">
            <div className="library-catalog-head"><span>Module</span><span>Steps</span><span>Source</span></div>
            <div className="library-catalog-list" role="listbox" aria-label="Local step modules">
              {visibleEntries.map((module) => (
                <button type="button" role="option" aria-selected={selected?.key === module.key} className={selected?.key === module.key ? "selected" : ""} key={module.key} onClick={() => setSelectedKey(module.key)}>
                  <span><strong>{module.label}</strong><small>{module.detail}</small><em>{module.tags.join(" · ") || "untagged"}</em></span>
                  <span className="library-step-count">{module.steps.length}<small>{module.multitouch ? "multi-touch" : "actions"}</small></span>
                  <span className="library-source-badge">{module.source}</span>
                </button>
              ))}
            </div>
          </section>

          {selected ? (
            <aside className="library-detail" aria-labelledby="library-detail-title">
              <header><div><p className="kicker">{selected.source === "saved" ? "Saved in this browser" : "Atlas Loop starter"}</p><h2 id="library-detail-title">{selected.label}</h2></div><span>{selected.steps.length} steps</span></header>
              <p className="library-detail-copy">{selected.detail}</p>
              <div className="library-tags" aria-label="Module tags">{selected.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
              {selected.multitouch ? <div className="library-backend-note"><strong>XCUITest required</strong><span>This module contains native pinch, rotate, or two-finger input.</span></div> : null}
              <ol className="library-step-preview">
                {selected.steps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><small>{step.action.kind}</small></div></li>)}
              </ol>
              <div className="library-detail-actions">
                <button type="button" className="library-use" onClick={() => createTestFromModule(selected, onCreateTest)}>Create test from module<ProductIcon icon={ArrowRight01Icon} size={14} /></button>
                <button type="button" onClick={() => duplicateModule(selected)}><ProductIcon icon={Copy01Icon} />{selected.source === "starter" ? "Save a copy" : "Duplicate"}</button>
                {selected.source === "saved" ? <button type="button" className="library-delete" onClick={() => setPendingDeleteId(selected.id)}><ProductIcon icon={Delete02Icon} />Delete</button> : null}
              </div>
              {pendingDeleteId === selected.id ? <div className="library-delete-confirm" role="alert"><span>Remove “{selected.label}”? Existing tests keep their inserted commands.</span><button type="button" onClick={() => removeModule(selected)}>Remove</button><button type="button" onClick={() => setPendingDeleteId(undefined)}>Keep</button></div> : null}
              <p className="library-message" role="status" aria-live="polite">{message}</p>
            </aside>
          ) : null}
        </div>
      )}

      {composerOpen ? <ModuleComposer onClose={() => setComposerOpen(false)} onSaved={(module) => { persistModule(module, `${module.label} saved in this browser.`); setComposerOpen(false); }} /> : null}
      </div> : <LaunchProfilesPanel onStart={onStartWithProfile} openComposerRequest={launchComposerRequest} onCountChange={setLaunchProfileCount} />}
    </section>
  );
}

function ModuleComposer({ onClose, onSaved }: { onClose: () => void; onSaved: (module: LocalTestModule) => void }) {
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [tags, setTags] = useState("smoke");
  const [script, setScript] = useState(DEFAULT_LOCAL_TEST_MODULE_SCRIPT);
  const compiled = useMemo(() => compileLocalTestScript(script), [script]);
  const nameError = !name.trim() ? "Give this module a name." : name.trim().length > 80 ? "Keep the module name under 80 characters." : "";
  const detailError = detail.trim().length > 240 ? "Keep the description under 240 characters." : "";
  const canSave = !nameError && !detailError && compiled.errors.length === 0 && compiled.steps.length > 0;
  const { dialogRef } = useModalDialog(onClose);

  const save = (): void => {
    if (!canSave) return;
    const now = new Date().toISOString();
    onSaved({
      id: createLocalModuleId(),
      label: name.trim(),
      detail: detail.trim() || `${compiled.steps.length} reusable deterministic steps.`,
      tags: normalizeTags(tags),
      script,
      steps: compiled.steps,
      createdAt: now,
      updatedAt: now
    });
  };

  return (
    <div className="library-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="library-composer" role="dialog" aria-modal="true" aria-labelledby="library-composer-title" tabIndex={-1}>
        <header><div><p className="kicker">Reusable step block</p><h2 id="library-composer-title">Create module</h2><span>Every line stays visible when this module is inserted into a test.</span></div><button type="button" aria-label="Close module composer" onClick={onClose}><ProductIcon icon={Cancel01Icon} /></button></header>
        <div className="library-composer-body">
          <div className="library-composer-fields">
            <label><span>Module name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout handoff" aria-invalid={Boolean(nameError)} />{nameError ? <small className="library-field-error">{nameError}</small> : <small>Shown in the local module catalog.</small>}</label>
            <label><span>Description</span><textarea className="library-description-field" value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="What this block proves and when to use it." aria-invalid={Boolean(detailError)} />{detailError ? <small className="library-field-error">{detailError}</small> : <small>Optional, but useful when a module is shared through a test definition.</small>}</label>
            <label><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="checkout, smoke" /><small>Up to eight comma-separated tags.</small></label>
            <label className="library-script-field"><span>Readable module steps</span><textarea value={script} onChange={(event) => setScript(event.target.value)} aria-label="Readable module steps" spellCheck={false} /><small>Uses the same bounded command grammar as local Tests.</small></label>
          </div>
          <div className="library-compile-preview">
            <header><div><span>Compiled preview</span><strong>{compiled.errors.length ? `${compiled.errors.length} issue${compiled.errors.length === 1 ? "" : "s"}` : `${compiled.steps.length} actions ready`}</strong></div><em className={compiled.errors.length ? "bad" : "good"}>{compiled.errors.length ? "Fix module" : "Valid"}</em></header>
            {compiled.errors.length ? <div className="library-compile-errors">{compiled.errors.map((error) => <div key={`${error.line}-${error.source}`}><span>LINE {error.line}</span><strong>{error.source || "Empty module"}</strong><p>{error.message}</p></div>)}</div> : <ol>{compiled.steps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><small>{step.action.kind}</small></div></li>)}</ol>}
          </div>
        </div>
        <footer><span>{canSave ? "Ready to save locally." : "Resolve the required fields and script issues."}</span><button type="button" onClick={onClose}>Cancel</button><button type="button" className="library-composer-save" disabled={!canSave} onClick={save}><ProductIcon icon={Add01Icon} />Save module</button></footer>
      </div>
    </div>
  );
}

function buildModuleEntries(saved: LocalTestModule[]): ModuleEntry[] {
  return [
    ...saved.map((module) => toModuleEntry(module, "saved")),
    ...LOCAL_TEST_MODULE_STARTERS.map((module) => toModuleEntry(module, "starter"))
  ];
}

function toModuleEntry(module: LocalTestModule, source: ModuleSource): ModuleEntry {
  return { ...module, key: `${source}:${module.id}`, source, multitouch: localTestModuleUsesMultiTouch(module) };
}

function filterModules(entries: ModuleEntry[], query: string, scope: ModuleScope, sort: ModuleSort): ModuleEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => {
      if (scope === "saved" && entry.source !== "saved") return false;
      if (scope === "starters" && entry.source !== "starter") return false;
      if (scope === "multitouch" && !entry.multitouch) return false;
      if (!terms.length) return true;
      const haystack = [entry.label, entry.detail, ...entry.tags, entry.script, ...entry.steps.map((step) => `${step.label} ${step.action.kind}`)].join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((left, right) => {
      if (sort === "name") return left.label.localeCompare(right.label);
      if (sort === "steps") return right.steps.length - left.steps.length || left.label.localeCompare(right.label);
      return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || (left.source === right.source ? left.label.localeCompare(right.label) : left.source === "saved" ? -1 : 1);
    });
}

function createTestFromModule(module: LocalTestModule, onCreateTest: (seed: LocalTestModuleSeed) => void): void {
  onCreateTest({ name: `${module.label} test`, detail: module.detail, tags: module.tags, script: module.script });
}

function normalizeTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean).map((tag) => tag.slice(0, 32)))].slice(0, 8);
}

function createLocalModuleId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `module-${crypto.randomUUID()}` : `module-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function LibraryMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" }) {
  return <div className={`library-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
