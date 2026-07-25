import { useEffect, useRef, useState } from "react";
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
        {/* Every link resolves to a section that exists on the page. */}
        <div className="landing-nav-links">
          <a href="#runtime">Drive</a>
          <a href="#tests">Author</a>
          <a href="#evidence">Prove</a>
          <a href="#atlas">Atlas</a>
          <a href="#quickstart">Quickstart</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <details className="landing-mobile-menu">
          <summary>Menu</summary>
          <div>
            <a href="#runtime">Drive</a>
            <a href="#tests">Author</a>
            <a href="#evidence">Prove</a>
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
            Selectors describe the implementation. Evidence describes the product. Atlas Loop gives coding agents a real
            iOS Simulator and keeps the observable run—screen, gesture, result, trace, artifacts—so a red state carries
            enough context to act on, without shipping source code to a hosted test cloud.
          </p>
          <div className="landing-actions">
            <a className="landing-primary-action" href={VIEWER_URL}>
              Launch local workspace <span aria-hidden="true">→</span>
            </a>
            <a className="landing-secondary-action" href={GITHUB_URL} target="_blank" rel="noreferrer">
              Read the source
            </a>
          </div>
          <p className="landing-audience">
            For engineers reproducing failures, QA and product reviewing the real flow, and coding agents that need to
            observe before they change code.
          </p>
        </div>

        <HeroWorkbench />
        <div className="landing-proof-line" aria-label="Product properties">
          <span><strong>01</strong> Real Simulator</span>
          <span><strong>02</strong> Local artifacts</span>
          <span><strong>03</strong> CLI + MCP</span>
          <span><strong>04</strong> Apache-2.0</span>
        </div>
      </section>

      <section className="landing-chapters" aria-label="Atlas Loop capabilities">
        <ChapterIndex />

        <article className="landing-chapter" id="runtime">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">Drive a real Simulator</p>
            <h2>One local runtime. Every operator.</h2>
            <p>Start a session from the workspace, CLI, or MCP. Build, install, launch, and drive the same Simulator while Atlas Loop keeps the state synchronized.</p>
            <ul><li>Auto-select a booted Simulator</li><li>XCUITest and Core Graphics input</li><li>Deep links to the exact active run</li></ul>
          </div>
          <RuntimeVisual />
          <ThemeSupport
            label="Also in this part"
            items={[
              {
                title: "Test motion, not just destinations",
                detail: "Pinch, rotate, two-finger tap, long press, and leading-edge navigation—the gestures selectors cannot describe."
              },
              {
                title: "Put the device somewhere",
                detail: "Place the Simulator at any coordinate or a named city, so business logic that differs by region is actually exercised."
              }
            ]}
          />
        </article>

        <article className="landing-chapter landing-chapter-reverse" id="tests">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">Author tests you can read</p>
            <h2>Readable steps. Exact actions. No hidden planner.</h2>
            <p>Write one command per line and inspect the exact Atlas Loop action it becomes before the Simulator is touched. Invalid lines stay local, point to the source, and block the run.</p>
            <ul><li>Deterministic commands with line-level errors</li><li>Optional app guard prevents wrong-target runs</li><li>Latest results stay beside each browser-local test</li></ul>
            <a className="landing-inline-link" href={TESTS_URL}>Open local tests →</a>
          </div>
          <TestAuthoringVisual />
          <ThemeSupport
            label="Also in this part"
            items={[
              {
                title: "Reuse the steps and the startup state",
                detail: "Proven command blocks and deterministic launch profiles, revalidated at every storage boundary.",
                href: LIBRARY_URL,
                linkLabel: "Open the local library"
              },
              {
                title: "Build once, inspect every action",
                detail: "Compose reusable gesture workflows from a blank start or a proven template, with live protocol validation.",
                href: WORKFLOW_URL,
                linkLabel: "Open the workflow library"
              }
            ]}
          />
        </article>

        <article className="landing-chapter" id="evidence">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">Keep the evidence</p>
            <h2>A failure should explain itself.</h2>
            <p>Every action can be paired with screenshots, video markers, CPU, memory, trace events, and artifact integrity. The handoff view turns that record into reproducible next commands.</p>
            <ul><li>Action-to-artifact correlation</li><li>Visual diff and replay tools</li><li>Portable artifact health reports</li></ul>
          </div>
          <EvidenceVisual />
          <ThemeSupport
            label="Also in this part"
            items={[
              {
                title: "A run should never disappear into a log folder",
                detail: "Every local run in one surface, filtered by status and input path, with the failure reason on the row.",
                href: SESSIONS_URL,
                linkLabel: "Open session history"
              },
              {
                title: "Every run makes the next run faster",
                detail: "App identity already captured in evidence becomes a launchpad that prefills the next session.",
                href: APPS_URL,
                linkLabel: "Browse observed apps"
              },
              {
                title: "File the issue from the failure",
                detail: "Turn a red run into a ticket carrying the failing step, the reason, the device, and a link back to this exact evidence."
              }
            ]}
          />
        </article>
      </section>

      <section className="landing-evidence" id="atlas">
        <div className="landing-evidence-copy">
          <p className="landing-section-index">ATLAS RUNTIME MAP</p>
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

/**
 * Three parts, in the order the product works: drive the device, author what
 * it should do, keep what it produced. Eight equally-weighted chapters gave a
 * first-time reader nothing to hold on to.
 */
const CHAPTERS: Array<{ id: string; label: string }> = [
  { id: "runtime", label: "Drive" },
  { id: "tests", label: "Author" },
  { id: "evidence", label: "Prove" }
];

interface ThemeSupportItem {
  title: string;
  detail: string;
  href?: string;
  linkLabel?: string;
}

/**
 * Capabilities that belong to a part but do not lead it. They keep their claim
 * and their link, and give up only the full-width visual, so the page shows
 * three pieces of proof instead of eight.
 */
function ThemeSupport({ label, items }: { label: string; items: ThemeSupportItem[] }) {
  return (
    <aside className="landing-theme-support" aria-label={label}>
      <p className="landing-section-index">{label}</p>
      <ul>
        {items.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <p>{item.detail}</p>
            {item.href && item.linkLabel ? (
              <a className="landing-inline-link" href={item.href}>
                {item.linkLabel} →
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Sticky index for the capability chapters. The active entry is whichever
 * chapter currently crosses the middle of the viewport, which tracks reading
 * position more honestly than "last heading scrolled past".
 */
function ChapterIndex() {
  const [activeId, setActiveId] = useState(CHAPTERS[0]!.id);
  const visibleIds = useRef(new Set<string>());

  useEffect(() => {
    // jsdom and very old browsers have no observer; the index still navigates.
    if (typeof IntersectionObserver !== "function") return;

    const sections = CHAPTERS
      .map((chapter) => document.getElementById(chapter.id))
      .filter((node): node is HTMLElement => node !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visibleIds.current.add(entry.target.id);
          else visibleIds.current.delete(entry.target.id);
        }
        const firstVisible = CHAPTERS.find((chapter) => visibleIds.current.has(chapter.id));
        if (firstVisible) setActiveId(firstVisible.id);
      },
      // Only the chapter crossing the middle band counts as current.
      { rootMargin: "-45% 0px -50% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="landing-chapter-index" aria-label="Capability chapters">
      <span>Chapters</span>
      <ol>
        {CHAPTERS.map((chapter) => (
          <li key={chapter.id}>
            <a
              href={`#${chapter.id}`}
              className={chapter.id === activeId ? "active" : undefined}
              aria-current={chapter.id === activeId ? "true" : undefined}
            >
              {chapter.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
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
        <p className="landing-section-index">FROM SOURCE TO SIGNAL</p>
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

/**
 * The iOS status bar straddles the Dynamic Island, so it reuses the island's
 * geometry variables from the device frame instead of a hand-tuned offset.
 */
function DeviceStatusBar() {
  return (
    <div className="preview-status-bar" aria-hidden="true">
      <span>9:41</span>
      <span className="preview-status-icons">
        <i className="preview-status-cellular" />
        <i className="preview-status-wifi" />
        <i className="preview-status-battery" />
      </span>
    </div>
  );
}

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
              <DeviceStatusBar />
              <div className="preview-app-bar"><span>{preview.appTitle}</span><small>{preview.appMeta}</small></div>
              <div className="preview-order-card">
                <span>{preview.cardLabel}</span>
                <strong>{preview.cardTitle}</strong>
                <p>{preview.cardDetail}</p>
                <div><span>{preview.metricLabel}</span><strong>{preview.metricValue}</strong></div>
              </div>
              <div className="preview-device-action">
                {preview.action}
                <span className="preview-tap-target" aria-hidden="true" />
              </div>
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
