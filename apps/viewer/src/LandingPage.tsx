import { useState } from "react";
import { IOSDeviceFrame } from "./components/IOSDeviceFrame.js";

const VIEWER_URL = "/?sessionId=latest&workspace=overview";
const APPS_URL = "/?sessionId=latest&workspace=apps";
const SESSIONS_URL = "/?sessionId=latest&workspace=sessions";
const TESTS_URL = "/?sessionId=latest&workspace=tests";
const LIBRARY_URL = "/?sessionId=latest&workspace=library";
const WORKFLOW_URL = "/?sessionId=latest&workspace=workflows";
const GITHUB_URL = "https://github.com/metaforismo/atlas-loop";

export function LandingPage() {
  return (
    <main className="landing-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <nav className="landing-nav" aria-label="Primary navigation">
        <a className="landing-brand" href="/" aria-label="Atlas Loop home">
          <img src="/atlas-loop-mark.png" alt="" />
          <span>Atlas Loop</span>
        </a>
        <div className="landing-nav-links">
          <a href="#runtime">Runtime</a>
          <a href="#tests">Tests</a>
          <a href="#library">Library</a>
          <a href="#workflows">Workflows</a>
          <a href="#evidence">Evidence</a>
          <a href="#atlas">Atlas</a>
          <a href="#quickstart">Quickstart</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <details className="landing-mobile-menu">
          <summary>Menu</summary>
          <div>
            <a href="#runtime">Runtime</a>
            <a href="#apps">Apps</a>
            <a href="#sessions">Sessions</a>
            <a href="#tests">Tests</a>
            <a href="#library">Library</a>
            <a href="#gestures">Gestures</a>
            <a href="#workflows">Workflows</a>
            <a href="#evidence">Evidence</a>
            <a href="#atlas">Atlas</a>
            <a href="#quickstart">Quickstart</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </div>
        </details>
        <a className="landing-nav-cta" href={VIEWER_URL}>
          Launch workspace <span aria-hidden="true">↗</span>
        </a>
      </nav>

      <section className="landing-hero" id="main-content" tabIndex={-1}>
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">
            <span /> Local iOS runtime · Simulator
          </p>
          <h1>
            <span>THE LOCAL</span>
            <span><em>RUNTIME</em> SOURCE</span>
            <span>OF TRUTH.</span>
          </h1>
          <p className="landing-lede">
            Give coding agents a real iOS Simulator, durable evidence, and an observed map of every flow—without shipping source code or runtime data to a hosted test cloud.
          </p>
          <div className="landing-actions">
            <a className="landing-primary-action" href={VIEWER_URL}>
              Launch local workspace <span aria-hidden="true">→</span>
            </a>
            <a className="landing-secondary-action" href={GITHUB_URL} target="_blank" rel="noreferrer">
              Read the source
            </a>
          </div>
        </div>

        <HeroWorkbench />
        <div className="landing-proof-line" aria-label="Product properties">
          <span><strong>01</strong> Real Simulator</span>
          <span><strong>02</strong> Local artifacts</span>
          <span><strong>03</strong> CLI + MCP</span>
          <span><strong>04</strong> Apache-2.0</span>
        </div>
      </section>

      <section className="landing-personas" aria-label="Built for the people and agents shipping mobile software">
        <p>BUILT FOR</p>
        <div><span>ENGINEERS</span><small>Reproduce failures with evidence</small></div>
        <div><span>QA + PRODUCT</span><small>Review the flow humans experience</small></div>
        <div><span>CODING AGENTS</span><small>Observe before changing code</small></div>
      </section>

      <section className="landing-manifesto" id="runtime">
        <p className="landing-section-index">01 / THE PROBLEM</p>
        <div>
          <h2>Selectors describe the implementation. Evidence describes the product.</h2>
          <p>
            Mobile test suites lose trust when harmless hierarchy changes look like product regressions. Atlas Loop keeps the observable run—the screen, gesture, result, trace, and artifacts—so a red state carries enough context to act on.
          </p>
        </div>
      </section>

      <section className="landing-chapters" aria-label="Atlas Loop capabilities">
        <article className="landing-chapter">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">02 / LIVE DEVICE CLI</p>
            <h2>One local runtime. Every operator.</h2>
            <p>Start a session from the workspace, CLI, or MCP. Build, install, launch, and drive the same Simulator while Atlas Loop keeps the state synchronized.</p>
            <ul><li>Auto-select a booted Simulator</li><li>XCUITest and Core Graphics input</li><li>Deep links to the exact active run</li></ul>
          </div>
          <RuntimeVisual />
        </article>

        <article className="landing-chapter landing-chapter-reverse" id="apps">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">03 / OBSERVED APP CATALOG</p>
            <h2>Every run should make the next run faster.</h2>
            <p>Atlas Loop turns app identity already captured in local session evidence into a focused launchpad. Find prior runs, pin the apps that matter, and prefill the next Simulator session without inventing a second registry.</p>
            <ul><li>Derived from bundle, scheme, or app path</li><li>Failed and blocked runs surface automatically</li><li>Browser-local pins with no hosted account</li></ul>
            <a className="landing-inline-link" href={APPS_URL}>Browse observed apps →</a>
          </div>
          <AppCatalogVisual />
        </article>

        <article className="landing-chapter" id="sessions">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">04 / SESSION CONTROL PLANE</p>
            <h2>A run should never disappear into a log folder.</h2>
            <p>See every local run in one focused surface, or open the global Live Monitor without replacing the workspace underneath. Filter history, inspect evidence health, and repeat a run with the captured app already filled in.</p>
            <ul><li>Live device and workflow activity without account sync</li><li>XCUITest and Core Graphics filters</li><li>Evidence, failures, duration, and Simulator context</li></ul>
            <a className="landing-inline-link" href={SESSIONS_URL}>Open session history →</a>
          </div>
          <SessionControlVisual />
        </article>

        <article className="landing-chapter landing-chapter-reverse" id="tests">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">05 / READABLE LOCAL TESTS</p>
            <h2>Readable steps. Exact actions. No hidden planner.</h2>
            <p>Write one command per line and inspect the exact Atlas Loop action it becomes before the Simulator is touched. Invalid lines stay local, point to the source, and block the run.</p>
            <ul><li>Deterministic commands with line-level errors</li><li>Optional app guard prevents wrong-target runs</li><li>Latest results stay beside each browser-local test</li></ul>
            <a className="landing-inline-link" href={TESTS_URL}>Open local tests →</a>
          </div>
          <TestAuthoringVisual />
        </article>

        <article className="landing-chapter" id="library">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">06 / VISIBLE STEP MODULES</p>
            <h2>Reuse steps without hiding them.</h2>
            <p>Keep proven command blocks in a local module library, then insert their readable source into a test. The result stays inspectable, editable, and independent of a remote registry.</p>
            <ul><li>Built-in and browser-saved modules</li><li>Exact action preview before saving</li><li>Storage boundaries recompile readable source</li></ul>
            <a className="landing-inline-link" href={LIBRARY_URL}>Open the module library →</a>
          </div>
          <ModuleLibraryVisual />
        </article>

        <article className="landing-chapter landing-chapter-reverse" id="gestures">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">07 / MULTI-GESTURE FLOWS</p>
            <h2>Test motion, not just destinations.</h2>
            <p>Drive the gestures selectors cannot describe: pinch, rotate, two-finger tap, long press, edge navigation, swipes, waits, and evidence checkpoints.</p>
            <ul><li>Native XCUITest multi-touch</li><li>Leading-edge iOS navigation</li><li>Per-step failure and cancellation</li></ul>
          </div>
          <GestureVisual />
        </article>

        <article className="landing-chapter" id="workflows">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">08 / LOCAL WORKFLOW LIBRARY</p>
            <h2>Build once. Inspect every action.</h2>
            <p>Compose reusable workflows where they live. Start blank or from a proven template, configure every gesture and accessibility target, then save the validated flow locally.</p>
            <ul><li>Focused builder with live protocol validation</li><li>Editable native multi-touch and element actions</li><li>Draft protection and safe browser-local storage</li></ul>
            <a className="landing-inline-link" href={WORKFLOW_URL}>Open the workflow library →</a>
          </div>
          <WorkflowVisual />
        </article>

        <article className="landing-chapter landing-chapter-reverse" id="evidence">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">09 / REPLAYABLE EVIDENCE</p>
            <h2>A failure should explain itself.</h2>
            <p>Every action can be paired with screenshots, video markers, CPU, memory, trace events, and artifact integrity. The handoff view turns that record into reproducible next commands.</p>
            <ul><li>Action-to-artifact correlation</li><li>Visual diff and replay tools</li><li>Portable artifact health reports</li></ul>
          </div>
          <EvidenceVisual />
        </article>
      </section>

      <section className="landing-evidence" id="atlas">
        <div className="landing-evidence-copy">
          <p className="landing-section-index">10 / ATLAS RUNTIME MAP</p>
          <h2>Every observed flow leaves a map.</h2>
          <p>
            The Atlas view derives screens and transitions from evidence already captured during a run. Deep links reconnect a map edge to the exact session, action, and artifact that produced it.
          </p>
          <a href={`${VIEWER_URL}&view=atlas`}>Open the Atlas map →</a>
        </div>
        <div className="landing-map-visual" aria-label="Example evidence map">
          <div className="map-node map-node-a"><span>Cart</span><small>3 actions</small></div>
          <div className="map-route map-route-a" />
          <div className="map-node map-node-b"><span>Checkout</span><small>5 actions</small></div>
          <div className="map-route map-route-b" />
          <div className="map-node map-node-c"><span>Confirmation</span><small>assert visible</small></div>
        </div>
      </section>

      <QuickstartSection />

      <section className="landing-closing">
        <p className="landing-section-index">READY WHEN THE SIMULATOR IS</p>
        <h2>Give the next agent proof,<br />not a hunch.</h2>
        <div className="landing-actions">
          <a className="landing-primary-action" href={VIEWER_URL}>Launch local workspace <span aria-hidden="true">→</span></a>
          <a className="landing-secondary-action" href={GITHUB_URL} target="_blank" rel="noreferrer">Install from source</a>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-brand">
          <img src="/atlas-loop-mark.png" alt="" />
          <span>Atlas Loop</span>
        </div>
        <p>Local evidence for agents that touch real interfaces.</p>
        <div className="landing-footer-links">
          <a href="https://github.com/metaforismo/atlas-loop#readme" target="_blank" rel="noreferrer">Documentation</a>
          <a href="https://github.com/metaforismo/atlas-loop/blob/main/docs/protocol.md" target="_blank" rel="noreferrer">Protocol</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">Apache-2.0 · GitHub</a>
        </div>
      </footer>
    </main>
  );
}

type QuickstartMode = "setup" | "services" | "session";
type CopyState = "idle" | "copied" | "error";

const QUICKSTARTS: Array<{ id: QuickstartMode; step: string; label: string; title: string; detail: string; commands: string }> = [
  {
    id: "setup",
    step: "01",
    label: "Verify",
    title: "Verify the checkout",
    detail: "Install dependencies, then confirm the types and local test suite before touching the Simulator.",
    commands: "npm install\nnpm run typecheck\nnpm test"
  },
  {
    id: "services",
    step: "02",
    label: "Start",
    title: "Start the local control plane",
    detail: "Run the evidence daemon and the viewer in separate terminals. Both bind to loopback by default.",
    commands: "npm run daemon -- --port 4317\n# In another terminal\nnpm run viewer"
  },
  {
    id: "session",
    step: "03",
    label: "Observe",
    title: "Open the first observable run",
    detail: "Check the host, select a Simulator, and launch a deep-linked workspace that follows the new session.",
    commands: "npm run cli -- doctor\nnpm run cli -- session start --simulator \"iPhone 16\" --viewer"
  }
];

function QuickstartSection() {
  const [selectedMode, setSelectedMode] = useState<QuickstartMode>("setup");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const quickstart = QUICKSTARTS.find((candidate) => candidate.id === selectedMode) ?? QUICKSTARTS[0]!;

  const copyCommands = async (): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(quickstart.commands);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  return (
    <section className="landing-quickstart" id="quickstart" aria-labelledby="landing-quickstart-title">
      <div className="landing-quickstart-copy">
        <p className="landing-section-index">11 / FROM SOURCE TO SIGNAL</p>
        <h2 id="landing-quickstart-title">A useful first run in three steps.</h2>
        <p>Atlas Loop does not hide the runtime behind a hosted account. Verify the repo, start two local processes, and follow the first Simulator session into an evidence-ready workspace.</p>
        <div className="landing-quickstart-links">
          <a href={VIEWER_URL}>Open the local overview →</a>
          <a href={`${GITHUB_URL}#quick-start`} target="_blank" rel="noreferrer">Read the full setup</a>
        </div>
      </div>
      <div className="landing-quickstart-console">
        <div className="quickstart-tabs" role="tablist" aria-label="Quickstart steps">
          {QUICKSTARTS.map((candidate) => (
            <button
              key={candidate.id}
              id={`quickstart-tab-${candidate.id}`}
              type="button"
              role="tab"
              aria-selected={candidate.id === selectedMode}
              aria-controls="quickstart-command-panel"
              onClick={() => { setSelectedMode(candidate.id); setCopyState("idle"); }}
            >
              <span>{candidate.step}</span>{candidate.label}
            </button>
          ))}
        </div>
        <div id="quickstart-command-panel" className="quickstart-command-panel" role="tabpanel" aria-labelledby={`quickstart-tab-${selectedMode}`} aria-live="polite">
          <header>
            <div><span>STEP {quickstart.step}</span><strong>{quickstart.title}</strong></div>
            <button type="button" onClick={() => void copyCommands()}>{copyState === "copied" ? "Copied" : "Copy commands"}</button>
          </header>
          <p>{quickstart.detail}</p>
          <pre><code>{quickstart.commands}</code></pre>
          <footer>
            <span><i aria-hidden="true" /> LOCAL ONLY</span>
            <span role="status">{copyState === "error" ? "Clipboard blocked — select the commands manually." : copyState === "copied" ? "Commands copied to clipboard." : "No hosted account required."}</span>
          </footer>
        </div>
      </div>
    </section>
  );
}

function RuntimeVisual() {
  return (
    <div className="landing-feature-visual runtime-visual" aria-label="Local runtime command preview">
      <div className="feature-visual-bar"><span>atlas-loop / runtime</span><small>CONNECTED</small></div>
      <div className="runtime-terminal">
        <p><span>$</span> atlas-loop session start <em>--input-backend xcuitest</em></p>
        <p className="terminal-muted">✓ iPhone 16 Pro · iOS 18.5 · booted</p>
        <p className="terminal-muted">✓ Session sess_4f8b · recording enabled</p>
        <p><span>$</span> atlas-loop launch <em>--session sess_4f8b</em></p>
        <p className="terminal-live"><i /> COMMERCEDEMO RUNNING</p>
      </div>
      <div className="runtime-metrics"><span><small>INPUT</small>XCUITest</span><span><small>LATENCY</small>42 ms</span><span><small>STORAGE</small>Local</span></div>
    </div>
  );
}

function AppCatalogVisual() {
  const apps = [
    { initials: "CD", name: "Commerce Demo", id: "app.atlasloop.CommerceDemo", runs: "12", state: "active" },
    { initials: "GL", name: "Gesture Lab", id: "app.atlasloop.GestureLab", runs: "8", state: "observed" },
    { initials: "LP", name: "Lantern Pay", id: "dev.lantern.payments", runs: "3", state: "attention" }
  ];
  return (
    <div className="landing-feature-visual app-catalog-visual" aria-label="Observed app catalog preview">
      <div className="feature-visual-bar"><span>LOCAL APP HISTORY</span><small>3 OBSERVED</small></div>
      <div className="app-catalog-toolbar"><span>⌕ Search bundle or Simulator</span><b>LAST OBSERVED ↓</b></div>
      <div className="app-catalog-list">
        {apps.map((app, index) => (
          <div className={index === 0 ? "selected" : ""} key={app.id}>
            <i>{app.initials}</i>
            <span><strong>{app.name}</strong><small>{app.id}</small></span>
            <em><b>{app.runs}</b><small>runs</small></em>
            <mark className={app.state}>{app.state}</mark>
          </div>
        ))}
      </div>
      <div className="app-catalog-footer"><span><small>SELECTED</small>Commerce Demo · iPhone 16 Pro</span><a href={APPS_URL}>START NEW RUN →</a></div>
    </div>
  );
}

function SessionControlVisual() {
  const sessions = [
    { id: "sess_4f8b", app: "Commerce Demo", state: "running", input: "xcuitest", evidence: "14" },
    { id: "sess_a91e", app: "Gesture Lab", state: "ended", input: "xcuitest", evidence: "9" },
    { id: "sess_27cd", app: "Lantern Pay", state: "attention", input: "cgevent", evidence: "3" }
  ];
  return (
    <div className="landing-feature-visual session-control-visual" aria-label="Local session control plane preview">
      <div className="feature-visual-bar"><span>LOCAL SESSION HISTORY</span><small>1 LIVE · 26 TOTAL</small></div>
      <div className="session-control-live"><i /><span><strong>Commerce Demo is running</strong><small>iPhone 16 Pro · XCUITest</small></span><b>OPEN EVIDENCE →</b></div>
      <div className="session-control-tabs"><strong>ALL</strong><span>LIVE</span><span>ATTENTION</span><span>COMPLETE</span><small>INPUT: ALL ↓</small></div>
      <div className="session-control-list">
        {sessions.map((session) => (
          <div key={session.id}>
            <span><strong>{session.app}</strong><small>{session.id}</small></span>
            <mark className={session.state}>{session.state}</mark>
            <code>{session.input}</code>
            <b>{session.evidence}<small> evidence</small></b>
          </div>
        ))}
      </div>
      <div className="session-control-footer"><span><small>SELECTED</small>sess_4f8b · 1m 42s</span><a href={SESSIONS_URL}>BROWSE RUNS →</a></div>
    </div>
  );
}

function TestAuthoringVisual() {
  const commands = [
    { source: 'Tap "Checkout"', action: "tapElement" },
    { source: 'Type "Avery"', action: "typeText" },
    { source: 'Verify "Order confirmed" is visible', action: "assertVisible" },
    { source: 'Capture "checkout-complete"', action: "screenshot" }
  ];
  return (
    <div className="landing-feature-visual test-authoring-visual" aria-label="Readable local test compiler preview">
      <div className="feature-visual-bar"><span>CHECKOUT CONFIRMATION / LOCAL TEST</span><small>4 ACTIONS READY</small></div>
      <div className="test-authoring-columns">
        <div className="test-authoring-source">
          <header><span>READABLE STEPS</span><em>SAVED LOCALLY</em></header>
          <ol>
            {commands.map((command, index) => <li key={command.source}><b>{String(index + 1).padStart(2, "0")}</b><code>{command.source}</code></li>)}
          </ol>
        </div>
        <div className="test-authoring-compiled">
          <header><span>COMPILED PREVIEW</span><em>VALID</em></header>
          <ol>
            {commands.map((command, index) => <li key={command.action}><i /><span><strong>{command.action}</strong><small>line {index + 1} · deterministic</small></span></li>)}
          </ol>
        </div>
      </div>
      <div className="test-authoring-footer"><span><i /> App guard · app.atlasloop.CommerceDemo</span><a href={TESTS_URL}>RUN 4 STEPS →</a></div>
    </div>
  );
}

function ModuleLibraryVisual() {
  const modules = [
    { name: "Checkout handoff", tag: "commerce", steps: "5 steps" },
    { name: "Settle and capture", tag: "evidence", steps: "2 steps" },
    { name: "Native canvas stress", tag: "multi-touch", steps: "4 steps" }
  ];
  return (
    <div className="landing-feature-visual module-library-visual" aria-label="Reusable local step module preview">
      <div className="feature-visual-bar"><span>LOCAL STEP MODULES</span><small>3 READY</small></div>
      <div className="module-library-body">
        <div className="module-library-list">
          <header><span>MODULE</span><small>VISIBLE SOURCE</small></header>
          {modules.map((module, index) => <div className={index === 0 ? "selected" : ""} key={module.name}><i /><span><strong>{module.name}</strong><small>{module.tag}</small></span><em>{module.steps}</em></div>)}
        </div>
        <div className="module-library-insert">
          <header><span>INSERTED INTO TEST</span><em>NO HIDDEN REF</em></header>
          <code>Tap "cart.continue"</code>
          <code>Tap "shipping.continue"</code>
          <code>Tap "payment-review.place-order"</code>
          <code>Verify "confirmation" is visible</code>
          <small>Readable commands are copied into the test definition.</small>
        </div>
      </div>
      <div className="module-library-footer"><span><i /> Source recompiled on save</span><a href={LIBRARY_URL}>OPEN LIBRARY →</a></div>
    </div>
  );
}

function GestureVisual() {
  const steps = ["Pinch open", "Rotate clockwise", "Two-finger tap", "Capture checkpoint"];
  return (
    <div className="landing-feature-visual gesture-visual" aria-label="Multi-gesture flow preview">
      <div className="feature-visual-bar"><span>NATIVE GESTURE AUDIT / XCUITEST</span><small>4 STEPS</small></div>
      <ol>
        {steps.map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{step}</strong><small>{index === 0 ? "pinch · scale 1.8" : index === 1 ? "rotate · 1.57 rad" : index === 2 ? "twoFingerTap" : "screenshot"}</small></span><i /></li>)}
      </ol>
      <div className="gesture-visual-footer"><span>Native multi-touch</span><a href={WORKFLOW_URL}>OPEN FLOWS →</a></div>
    </div>
  );
}

function WorkflowVisual() {
  const actions = [
    { name: "Tap checkout.continue", meta: "tapElement" },
    { name: "Wait for layout", meta: "wait · 500 ms" },
    { name: "Pinch confirmation", meta: "pinch · scale 1.8" }
  ];
  return (
    <div className="landing-feature-visual workflow-visual workflow-builder-visual" aria-label="Validated local workflow builder preview">
      <div className="feature-visual-bar"><span>CREATE LOCAL WORKFLOW</span><small>VALID</small></div>
      <div className="workflow-builder-visual-summary"><span><small>WORKFLOW</small><strong>Checkout recovery</strong></span><span><small>STEPS</small><strong>3</strong></span><span><small>INPUT</small><strong>XCUITest</strong></span></div>
      <div className="workflow-builder-visual-body">
        <ol>
          {actions.map((action, index) => <li key={action.name}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{action.name}</strong><small>{action.meta}</small></span><i /></li>)}
        </ol>
        <aside><small>ACTION LIBRARY</small><span>Swipe up <b>+</b></span><span>Two-finger tap <b>+</b></span><span>Capture checkpoint <b>+</b></span></aside>
      </div>
      <div className="workflow-visual-run"><span><small>VALIDATION</small>Every action compiles</span><a href={WORKFLOW_URL}>SAVE WORKFLOW →</a></div>
    </div>
  );
}

function EvidenceVisual() {
  return (
    <div className="landing-feature-visual evidence-visual" aria-label="Replayable evidence preview">
      <div className="feature-visual-bar"><span>OBSERVED FLOW / ACTION 07</span><small>VERIFIED</small></div>
      <div className="evidence-frame-grid">
        <div className="evidence-mini-phone"><span>ORDER CONFIRMED</span><strong>Thanks, Avery.</strong><i /></div>
        <div className="evidence-event-list">
          <p><span>09:41:12.204</span><strong>tapElement</strong><em>passed</em></p>
          <p><span>09:41:12.249</span><strong>screenshot</strong><em>saved</em></p>
          <p><span>09:41:12.312</span><strong>assertVisible</strong><em>passed</em></p>
        </div>
      </div>
      <div className="runtime-metrics"><span><small>ARTIFACTS</small>08</span><span><small>CPU</small>4.7%</span><span><small>HEALTH</small>Clean</span></div>
    </div>
  );
}

type HeroPreviewMode = "flow" | "gestures" | "monitor" | "handoff";

const HERO_PREVIEWS: Array<{
  id: HeroPreviewMode;
  label: string;
  runLabel: string;
  title: string;
  completed: number;
  appTitle: string;
  appMeta: string;
  cardLabel: string;
  cardTitle: string;
  cardDetail: string;
  metricLabel: string;
  metricValue: string;
  action: string;
  evidence: string[];
  steps: Array<{ label: string; meta: string; state: "passed" | "running" }>;
}> = [
  {
    id: "flow",
    label: "Observed flow",
    runLabel: "OBSERVED FLOW",
    title: "Checkout still works",
    completed: 3,
    appTitle: "Checkout",
    appMeta: "Secure",
    cardLabel: "ORDER SUMMARY",
    cardTitle: "Canvas Weekender",
    cardDetail: "Natural canvas · one size",
    metricLabel: "Total",
    metricValue: "$84",
    action: "Place order",
    evidence: ["7 screenshots", "trace.jsonl", "CPU 4.7%"],
    steps: [
      { label: "Launch CommerceDemo", meta: "1.4s", state: "passed" },
      { label: "Open the cart", meta: "0.8s", state: "passed" },
      { label: "Continue to checkout", meta: "1.1s", state: "passed" },
      { label: "Confirm the order", meta: "running", state: "running" }
    ]
  },
  {
    id: "gestures",
    label: "Native gestures",
    runLabel: "GESTURE AUDIT",
    title: "Motion stays testable",
    completed: 2,
    appTitle: "Gesture Lab",
    appMeta: "XCUITest",
    cardLabel: "CANVAS STATE",
    cardTitle: "Scale 1.30",
    cardDetail: "Rotation 0.35 rad",
    metricLabel: "Touches",
    metricValue: "2",
    action: "Run gesture",
    evidence: ["pinch + rotate", "after.png", "0 issues"],
    steps: [
      { label: "Open gesture canvas", meta: "0.6s", state: "passed" },
      { label: "Pinch open", meta: "scale 1.30", state: "passed" },
      { label: "Rotate clockwise", meta: "0.35 rad", state: "running" },
      { label: "Capture checkpoint", meta: "queued", state: "running" }
    ]
  },
  {
    id: "handoff",
    label: "Agent handoff",
    runLabel: "HANDOFF BUNDLE",
    title: "The next agent gets proof",
    completed: 4,
    appTitle: "Evidence",
    appMeta: "Local only",
    cardLabel: "BUNDLE READY",
    cardTitle: "sess_4f8b",
    cardDetail: "Manifest and commands verified",
    metricLabel: "Files",
    metricValue: "14",
    action: "Copy commands",
    evidence: ["handoff.json", "manifest.json", "verified"],
    steps: [
      { label: "Verify artifacts", meta: "clean", state: "passed" },
      { label: "Build evidence report", meta: "saved", state: "passed" },
      { label: "Export local bundle", meta: "14 files", state: "passed" },
      { label: "Prepare next commands", meta: "ready", state: "passed" }
    ]
  },
  {
    id: "monitor",
    label: "Live monitor",
    runLabel: "LOCAL OPERATIONS",
    title: "Every run stays in sight",
    completed: 3,
    appTitle: "Runtime Watch",
    appMeta: "Connected",
    cardLabel: "ACTIVE DEVICE",
    cardTitle: "iPhone 16 Pro",
    cardDetail: "dev.atlas.commerce · XCUITest",
    metricLabel: "Evidence",
    metricValue: "12",
    action: "Open live run",
    evidence: ["2 devices", "1 workflow", "daemon live"],
    steps: [
      { label: "Gesture Lab session", meta: "running", state: "passed" },
      { label: "Evidence timeline", meta: "12 artifacts", state: "passed" },
      { label: "Integrity check", meta: "clean", state: "passed" },
      { label: "Checkout regression", meta: "step 3 of 4", state: "running" }
    ]
  }
];

function HeroWorkbench() {
  const [selectedMode, setSelectedMode] = useState<HeroPreviewMode>("flow");
  const preview = HERO_PREVIEWS.find((candidate) => candidate.id === selectedMode) ?? HERO_PREVIEWS[0]!;

  return (
    <div className="landing-workbench" aria-label="Atlas Loop product preview">
      <div className="landing-workbench-topbar">
        <div><span className="window-dot" /><span className="window-dot" /><span className="window-dot" /></div>
        <div className="preview-mode-tabs" role="tablist" aria-label="Product preview modes">
          {HERO_PREVIEWS.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={mode.id === selectedMode}
              onClick={() => setSelectedMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <span className="preview-status">Live</span>
      </div>
      <div className={`landing-workbench-body preview-mode-${preview.id}`} aria-live="polite">
        <div className="preview-device-column">
          <IOSDeviceFrame
            label={`${preview.appTitle} running on an iPhone Simulator`}
            meta={`iPhone 16 Pro · ${preview.appMeta}`}
            status="online"
            variant="hero"
          >
            <div className="preview-device-screen">
              <div className="preview-app-bar"><span>{preview.appTitle}</span><small>{preview.appMeta}</small></div>
              <div className="preview-order-card">
                <span>{preview.cardLabel}</span>
                <strong>{preview.cardTitle}</strong>
                <p>{preview.cardDetail}</p>
                <div><span>{preview.metricLabel}</span><strong>{preview.metricValue}</strong></div>
              </div>
              <div className="preview-device-action">{preview.action}</div>
              <span className="preview-tap-target" />
            </div>
          </IOSDeviceFrame>
        </div>
        <div className="preview-steps-column">
          <div className="preview-run-heading">
            <div><small>{preview.runLabel}</small><strong>{preview.title}</strong></div>
            <span>{preview.completed} / {preview.steps.length}</span>
          </div>
          <div className="preview-progress"><span style={{ transform: `scaleX(${preview.completed / preview.steps.length})` }} /></div>
          <div className="preview-step-list">
            {preview.steps.map((step, index) => (
              <div className={`preview-step ${step.state}`} key={step.label}>
                <span>{index + 1}</span>
                <div><strong>{step.label}</strong><small>{step.meta}</small></div>
                <i aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="preview-evidence-bar">
            {preview.evidence.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
