import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Add01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  EyeIcon,
  FileSearchIcon,
  PlayIcon,
  Search01Icon,
  StopIcon
} from "@hugeicons/core-free-icons";
import { runGestureSequenceSteps } from "../gestureSequenceRunner.js";
import {
  compileLocalTestScript,
  DEFAULT_LOCAL_TEST_SCRIPT,
  LOCAL_TEST_STARTERS,
  localTestUsesMultiTouch,
  type LocalTestDefinition,
  type LocalTestRunRecord
} from "../localTests.js";
import {
  deleteLocalTest,
  loadLocalTestRuns,
  loadSavedLocalTests,
  saveLocalTest,
  saveLocalTestRun
} from "../localTestStorage.js";
import type { Session, ViewerParams } from "../types.js";
import { useModalDialog } from "../useModalDialog.js";
import { formatDateTime } from "../viewerPresentation.js";
import type { ActionMutationState } from "./ActionPanel.js";
import { ProductIcon } from "./ProductIcon.js";

type TestSource = "saved" | "template";
type TestScope = "all" | "saved" | "templates" | "multitouch";
type TestStatusFilter = "all" | "passed" | "failed" | "not-run";
type TestSort = "recent" | "name" | "steps";

interface TestEntry extends LocalTestDefinition {
  key: string;
  source: TestSource;
  multitouch: boolean;
}

type TestRunState =
  | { status: "idle" }
  | { status: "running"; testKey: string; step: number; total: number; label: string }
  | { status: "passed" | "failed" | "cancelled"; testKey: string; message: string };

const TEST_SCOPES: Array<{ id: TestScope; label: string }> = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "templates", label: "Templates" },
  { id: "multitouch", label: "Multi-touch" }
];

const TEST_STATUS_FILTERS: Array<{ id: TestStatusFilter; label: string }> = [
  { id: "all", label: "Every result" },
  { id: "passed", label: "Passed" },
  { id: "failed", label: "Failed" },
  { id: "not-run", label: "Not run" }
];

export function TestWorkspace({
  params,
  selectedSessionId,
  session,
  mutationState,
  onOpenEvidence,
  onStartSession
}: {
  params: ViewerParams;
  selectedSessionId: string;
  session?: Session;
  mutationState: ActionMutationState;
  onOpenEvidence: () => void;
  onStartSession: (bundleId?: string) => void;
}) {
  const [saved, setSaved] = useState<LocalTestDefinition[]>(() => loadSavedLocalTests());
  const [runs, setRuns] = useState<LocalTestRunRecord[]>(() => loadLocalTestRuns());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<TestScope>("all");
  const [statusFilter, setStatusFilter] = useState<TestStatusFilter>("all");
  const [sort, setSort] = useState<TestSort>("recent");
  const [selectedKey, setSelectedKey] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [message, setMessage] = useState("");
  const [runState, setRunState] = useState<TestRunState>({ status: "idle" });
  const abortRef = useRef<AbortController | undefined>(undefined);
  const deferredQuery = useDeferredValue(query);

  const entries = useMemo(() => buildTestEntries(saved), [saved]);
  const visibleEntries = useMemo(
    () => filterTestEntries(entries, runs, deferredQuery, scope, statusFilter, sort),
    [entries, runs, deferredQuery, scope, statusFilter, sort]
  );
  const selected = visibleEntries.find((entry) => entry.key === selectedKey) ?? visibleEntries[0];
  const selectedRun = selected ? runs.find((run) => run.testKey === selected.key) : undefined;
  const running = runState.status === "running";
  const currentBundleId = session?.app?.bundleId;
  const appMismatch = Boolean(selected?.appBundleId && selected.appBundleId !== currentBundleId);
  const canRunSelected = Boolean(selected && mutationState.canSubmitActions && !appMismatch && !running);
  const passed = entries.filter((entry) => runs.some((run) => run.testKey === entry.key && run.status === "passed")).length;
  const failed = entries.filter((entry) => runs.some((run) => run.testKey === entry.key && run.status === "failed")).length;
  const notRun = entries.length - passed - failed;
  const hasFilters = query.trim().length > 0 || scope !== "all" || statusFilter !== "all" || sort !== "recent";

  useEffect(() => {
    if (!selected) {
      setSelectedKey("");
      return;
    }
    if (selected.key !== selectedKey) setSelectedKey(selected.key);
  }, [selected, selectedKey]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setRunState({ status: "idle" });
    return () => abortRef.current?.abort();
  }, [params.daemonUrl, selectedSessionId]);

  const resetFilters = (): void => {
    setQuery("");
    setScope("all");
    setStatusFilter("all");
    setSort("recent");
  };

  const runTest = async (test: TestEntry): Promise<void> => {
    if (!canRunSelected) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const result = await runGestureSequenceSteps({
      params: { ...params, sessionId: selectedSessionId },
      sequence: test,
      signal: controller.signal,
      onProgress: (step, index, total) => {
        setRunState({ status: "running", testKey: test.key, step: index + 1, total, label: step.label });
      }
    });
    if (abortRef.current !== controller) return;
    abortRef.current = undefined;

    if (result.status === "success") {
      const resultMessage = `${result.completedSteps} steps passed and were written to the evidence timeline.`;
      setRunState({ status: "passed", testKey: test.key, message: resultMessage });
      recordRun({ testKey: test.key, status: "passed", sessionId: selectedSessionId, completedSteps: result.completedSteps, totalSteps: test.steps.length, message: resultMessage, ranAt: new Date().toISOString() });
      return;
    }
    if (result.status === "cancelled") {
      const resultMessage = `Stopped after ${result.completedSteps} completed steps.`;
      setRunState({ status: "cancelled", testKey: test.key, message: resultMessage });
      recordRun({ testKey: test.key, status: "cancelled", sessionId: selectedSessionId, completedSteps: result.completedSteps, totalSteps: test.steps.length, message: resultMessage, ranAt: new Date().toISOString() });
      return;
    }
    const resultMessage = `${result.failedStep.label} failed: ${result.message}`;
    setRunState({ status: "failed", testKey: test.key, message: resultMessage });
    recordRun({ testKey: test.key, status: "failed", sessionId: selectedSessionId, completedSteps: result.completedSteps, totalSteps: test.steps.length, message: resultMessage, ranAt: new Date().toISOString() });
  };

  const recordRun = (record: LocalTestRunRecord): void => {
    try {
      setRuns(saveLocalTestRun(record));
    } catch {
      setRuns((current) => [record, ...current.filter((candidate) => candidate.testKey !== record.testKey)]);
      setMessage("The result is visible now, but this browser blocked local result storage.");
    }
  };

  const cancelRun = (): void => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    if (runState.status !== "running") return;
    const record: LocalTestRunRecord = {
      testKey: runState.testKey,
      status: "cancelled",
      sessionId: selectedSessionId,
      completedSteps: Math.max(0, runState.step - 1),
      totalSteps: runState.total,
      message: "Stopped. No further actions were sent to the daemon.",
      ranAt: new Date().toISOString()
    };
    setRunState({ status: "cancelled", testKey: runState.testKey, message: record.message });
    recordRun(record);
  };

  const removeTest = (test: TestEntry): void => {
    if (test.source !== "saved") return;
    try {
      setSaved(deleteLocalTest(test.id));
      setPendingDeleteId(undefined);
      setSelectedKey("");
      setMessage(`${test.label} removed from this browser.`);
    } catch {
      setMessage("This browser could not remove the saved test.");
    }
  };

  return (
    <section id="test-workspace" className="test-workspace" aria-labelledby="test-workspace-title" tabIndex={-1}>
      <header className="test-workspace-header">
        <div>
          <p className="kicker">Deterministic local authoring</p>
          <h1 id="test-workspace-title">Tests</h1>
          <p>Write readable steps, inspect the exact actions they compile to, then run them against the selected Simulator session.</p>
        </div>
        <div className="test-workspace-header-actions">
          <button type="button" className="test-secondary-action" onClick={onOpenEvidence}><ProductIcon icon={EyeIcon} />Open live evidence</button>
          <button type="button" className="test-primary-action" onClick={() => setComposerOpen(true)}><ProductIcon icon={Add01Icon} />Create test</button>
        </div>
      </header>

      <div className="test-workspace-metrics" aria-label="Local test metrics">
        <TestMetric label="Total tests" value={String(entries.length)} detail={`${saved.length} saved in this browser`} />
        <TestMetric label="Passing" value={String(passed)} detail="Latest local result" tone={passed ? "good" : "neutral"} />
        <TestMetric label="Failing" value={String(failed)} detail="Latest local result" tone={failed ? "bad" : "neutral"} />
        <TestMetric label="Not run" value={String(notRun)} detail="No completed result yet" />
      </div>

      <div className="test-run-context" role="status" aria-live="polite">
        <div className={`test-run-context-signal tone-${mutationState.tone}`}><span aria-hidden="true" /><div><small>Selected session</small><strong>{selectedSessionId}</strong></div></div>
        <div><small>Current app</small><strong>{currentBundleId ?? session?.app?.scheme ?? "No app metadata"}</strong></div>
        <div><small>Mutation readiness</small><strong>{mutationState.title}</strong><span>{mutationState.detail}</span></div>
        <button type="button" onClick={() => onStartSession(selected?.appBundleId)}><span>{selected?.appBundleId ? "Start matching app" : "Start a session"}</span><ProductIcon icon={ArrowRight01Icon} size={14} /></button>
      </div>

      <div className="test-workspace-controls" role="search" aria-label="Filter local tests">
        <label className="test-workspace-search"><ProductIcon icon={Search01Icon} size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search test, tag, command, or app…" aria-label="Search local tests" /></label>
        <div className="test-workspace-scopes" role="group" aria-label="Test source filter">
          {TEST_SCOPES.map((option) => <button type="button" key={option.id} aria-pressed={scope === option.id} onClick={() => setScope(option.id)}>{option.label}</button>)}
        </div>
        <label className="test-workspace-status"><span>Result</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TestStatusFilter)} aria-label="Filter tests by result">{TEST_STATUS_FILTERS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label>
        <label className="test-workspace-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as TestSort)} aria-label="Sort local tests"><option value="recent">Last result</option><option value="name">Name</option><option value="steps">Most steps</option></select></label>
      </div>

      <div className="test-workspace-result-bar" role="status">
        <span>{visibleEntries.length} of {entries.length} tests</span>
        {hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : <small>Definitions and results stay in this browser</small>}
      </div>

      {visibleEntries.length === 0 ? (
        <div className="test-workspace-empty"><ProductIcon icon={FileSearchIcon} size={28} /><strong>No tests match</strong><p>Clear the current query, source, or result filter to return to the complete local library.</p><button type="button" onClick={resetFilters}>Clear filters</button></div>
      ) : (
        <div className="test-workspace-grid">
          <section className="test-catalog" aria-label="Available local tests">
            <div className="test-catalog-header"><span>Test</span><span>Result</span><span>Steps</span><span>Source</span></div>
            <div role="listbox" aria-label="Local test definitions">
              {visibleEntries.map((test) => {
                const lastRun = runs.find((run) => run.testKey === test.key);
                return (
                  <button type="button" role="option" aria-selected={test.key === selected?.key} className={test.key === selected?.key ? "selected" : ""} key={test.key} onClick={() => { setSelectedKey(test.key); setPendingDeleteId(undefined); }}>
                    <span className="test-catalog-identity"><strong>{test.label}</strong><small>{test.appBundleId ?? "Any selected app"}</small><em>{test.tags.join(" · ") || "untagged"}</em></span>
                    <span className={`test-result-badge status-${displayRunStatus(lastRun)}`}>{displayRunStatus(lastRun)}</span>
                    <span className="test-catalog-steps">{test.steps.length}<small>{test.multitouch ? "multi-touch" : "actions"}</small></span>
                    <span className="test-source-badge">{test.source}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {selected ? (
            <aside className="test-detail" aria-labelledby="test-detail-title">
              <header>
                <div><p className="kicker">{selected.source === "saved" ? "Saved in this browser" : "Atlas Loop starter"}</p><h2 id="test-detail-title">{selected.label}</h2></div>
                <span className={`test-result-badge status-${displayRunStatus(selectedRun)}`}>{displayRunStatus(selectedRun)}</span>
              </header>
              <p className="test-detail-copy">{selected.detail}</p>
              <div className="test-detail-meta">
                <span><small>PLATFORM</small><strong>iOS Simulator</strong></span>
                <span><small>EXPECTED APP</small><strong>{selected.appBundleId ?? "Current session"}</strong></span>
              </div>
              {appMismatch ? <div className="test-app-mismatch"><strong>Selected app does not match</strong><span>This test expects {selected.appBundleId}; the current session reports {currentBundleId ?? "no bundle ID"}.</span><button type="button" onClick={() => onStartSession(selected.appBundleId)}>Start matching app</button></div> : null}
              {selected.multitouch ? <div className="test-backend-note"><strong>XCUITest required</strong><span>Native pinch, rotation, and two-finger steps require an XCUITest session.</span></div> : null}
              <ol className="test-step-preview">
                {selected.steps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><small>{step.action.kind}</small></div><i className={testRunStepState(runState, selected.key, index)} aria-hidden="true" /></li>)}
              </ol>
              {selectedRun ? <div className={`test-last-result status-${selectedRun.status}`}><header><span>Last local result</span><time>{formatDateTime(selectedRun.ranAt)}</time></header><strong>{selectedRun.completedSteps}/{selectedRun.totalSteps} steps · {selectedRun.status}</strong><p>{selectedRun.message}</p><small>{selectedRun.sessionId}</small></div> : null}
              <div className={`test-active-run status-${runState.status}`} aria-live="polite">
                <span>{testRunMessage(runState, selected.key)}</span>
              </div>
              <div className="test-detail-actions">
                {running ? <button type="button" className="test-stop" onClick={cancelRun}><ProductIcon icon={StopIcon} />Stop active test</button> : <button type="button" className="test-run" disabled={!canRunSelected} title={appMismatch ? "Start a session with the expected app first" : !mutationState.canSubmitActions ? mutationState.title : undefined} onClick={() => void runTest(selected)}><ProductIcon icon={PlayIcon} />{`Run ${selected.steps.length} steps`}</button>}
                {selected.source === "saved" ? <button type="button" className="test-delete" disabled={running} onClick={() => setPendingDeleteId(selected.id)}><ProductIcon icon={Delete02Icon} />Delete</button> : null}
              </div>
              {pendingDeleteId === selected.id ? <div className="test-delete-confirm" role="alert"><span>Remove “{selected.label}” and keep its evidence untouched?</span><button type="button" onClick={() => removeTest(selected)}>Remove</button><button type="button" onClick={() => setPendingDeleteId(undefined)}>Keep</button></div> : null}
              <p className="test-workspace-message" role="status" aria-live="polite">{message}</p>
            </aside>
          ) : null}
        </div>
      )}

      {composerOpen ? <TestComposer onClose={() => setComposerOpen(false)} onSaved={(test) => {
        try {
          setSaved(saveLocalTest(test));
          setSelectedKey(`saved:${test.id}`);
          setScope("saved");
          setStatusFilter("all");
          setMessage(`${test.label} saved in this browser.`);
          setComposerOpen(false);
        } catch {
          setMessage("This browser blocked local test storage. Check its site-data permissions.");
        }
      }} /> : null}
    </section>
  );
}

function TestComposer({ onClose, onSaved }: { onClose: () => void; onSaved: (test: LocalTestDefinition) => void }) {
  const [name, setName] = useState("");
  const [bundleId, setBundleId] = useState("");
  const [tags, setTags] = useState("smoke");
  const [script, setScript] = useState(DEFAULT_LOCAL_TEST_SCRIPT);
  const compiled = useMemo(() => compileLocalTestScript(script), [script]);
  const nameError = name.trim() ? "" : "Give this test a name.";
  const canSave = !nameError && compiled.errors.length === 0 && compiled.steps.length > 0;
  const { dialogRef } = useModalDialog(onClose);

  const save = (): void => {
    if (!canSave) return;
    const now = new Date().toISOString();
    onSaved({
      id: `test-${Date.now().toString(36)}`,
      label: name.trim(),
      detail: `${compiled.steps.length} deterministic local steps compiled from readable commands.`,
      platform: "ios-simulator",
      appBundleId: bundleId.trim() || undefined,
      tags: [...new Set(tags.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 8),
      script,
      steps: compiled.steps,
      createdAt: now,
      updatedAt: now
    });
  };

  return (
    <div className="test-composer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="test-composer" role="dialog" aria-modal="true" aria-labelledby="test-composer-title" tabIndex={-1}>
        <header><div><p className="kicker">Local test definition</p><h2 id="test-composer-title">Create test</h2><span>Readable commands compile into the existing Atlas Loop action protocol.</span></div><button type="button" aria-label="Close test composer" onClick={onClose}><ProductIcon icon={Cancel01Icon} /></button></header>
        <div className="test-composer-body">
          <div className="test-composer-fields">
            <label><span>Test name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Checkout stays recoverable" aria-invalid={Boolean(nameError)} />{nameError ? <small className="test-field-error">{nameError}</small> : <small>Used in the local test library.</small>}</label>
            <label><span>Expected app bundle ID</span><input value={bundleId} onChange={(event) => setBundleId(event.target.value)} placeholder="app.atlasloop.CommerceDemo" spellCheck={false} /><small>Optional. A mismatch blocks accidental execution against the wrong app.</small></label>
            <label><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="smoke, checkout" /><small>Comma-separated, stored only in this browser.</small></label>
            <label className="test-script-field"><span>Plain-language test steps</span><textarea value={script} onChange={(event) => setScript(event.target.value)} aria-label="Plain-language test steps" spellCheck={false} /><small>One deterministic command per line. Comments start with #.</small></label>
            <details className="test-command-reference"><summary>Supported commands</summary><code>Tap "identifier"</code><code>Tap at 50% 80%</code><code>Type "text"</code><code>Swipe up</code><code>Wait 800ms</code><code>Back</code><code>Long press center</code><code>Pinch open on "identifier"</code><code>Rotate clockwise</code><code>Two-finger tap "identifier"</code><code>Verify "identifier" is visible</code><code>Capture "reason"</code></details>
          </div>
          <div className="test-compile-preview">
            <header><div><span>Compiled preview</span><strong>{compiled.errors.length ? `${compiled.errors.length} issue${compiled.errors.length === 1 ? "" : "s"}` : `${compiled.steps.length} actions ready`}</strong></div><em className={compiled.errors.length ? "bad" : "good"}>{compiled.errors.length ? "Fix script" : "Valid"}</em></header>
            {compiled.errors.length ? <div className="test-compile-errors">{compiled.errors.map((error) => <div key={`${error.line}-${error.source}`}><span>LINE {error.line}</span><strong>{error.source || "Empty test"}</strong><p>{error.message}</p></div>)}</div> : <ol>{compiled.steps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><small>{step.action.kind}</small></div></li>)}</ol>}
          </div>
        </div>
        <footer><span>{canSave ? "Ready to save locally." : "Resolve the required fields and script issues."}</span><button type="button" onClick={onClose}>Cancel</button><button type="button" className="test-composer-save" disabled={!canSave} onClick={save}><ProductIcon icon={Add01Icon} />Save local test</button></footer>
      </div>
    </div>
  );
}

function buildTestEntries(saved: LocalTestDefinition[]): TestEntry[] {
  return [
    ...saved.map((test) => toTestEntry(test, "saved")),
    ...LOCAL_TEST_STARTERS.map((test) => toTestEntry(test, "template"))
  ];
}

function toTestEntry(test: LocalTestDefinition, source: TestSource): TestEntry {
  return { ...test, key: `${source}:${test.id}`, source, multitouch: localTestUsesMultiTouch(test) };
}

function filterTestEntries(entries: TestEntry[], runs: LocalTestRunRecord[], query: string, scope: TestScope, statusFilter: TestStatusFilter, sort: TestSort): TestEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const runByKey = new Map(runs.map((run) => [run.testKey, run]));
  return entries
    .filter((entry) => {
      if (scope === "saved" && entry.source !== "saved") return false;
      if (scope === "templates" && entry.source !== "template") return false;
      if (scope === "multitouch" && !entry.multitouch) return false;
      const status = displayRunStatus(runByKey.get(entry.key));
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!terms.length) return true;
      const haystack = [entry.label, entry.detail, entry.appBundleId, ...entry.tags, entry.script, ...entry.steps.map((step) => `${step.label} ${step.action.kind}`)].filter(Boolean).join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((left, right) => {
      if (sort === "name") return left.label.localeCompare(right.label);
      if (sort === "steps") return right.steps.length - left.steps.length || left.label.localeCompare(right.label);
      const leftRun = runByKey.get(left.key)?.ranAt ?? "";
      const rightRun = runByKey.get(right.key)?.ranAt ?? "";
      return rightRun.localeCompare(leftRun) || left.label.localeCompare(right.label);
    });
}

function displayRunStatus(run: LocalTestRunRecord | undefined): "passed" | "failed" | "not-run" {
  return run?.status === "passed" ? "passed" : run?.status === "failed" ? "failed" : "not-run";
}

function testRunMessage(state: TestRunState, selectedKey: string): string {
  if (state.status === "idle") return "Ready to compile actions into the selected evidence timeline.";
  if (state.testKey !== selectedKey) return `Another test is active: ${state.status === "running" ? `step ${state.step} of ${state.total}` : state.message}`;
  if (state.status === "running") return `Step ${state.step} of ${state.total}: ${state.label}`;
  return state.message;
}

function testRunStepState(state: TestRunState, testKey: string, index: number): string {
  if (state.status !== "running" || state.testKey !== testKey) return "";
  if (index + 1 < state.step) return "complete";
  if (index + 1 === state.step) return "active";
  return "";
}

function TestMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "bad" }) {
  return <div className={`test-workspace-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
