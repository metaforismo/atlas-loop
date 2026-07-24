const VIEWER_URL = "/?sessionId=latest";
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
          <a href="#gestures">Gestures</a>
          <a href="#atlas">Atlas</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <a className="landing-nav-cta" href={VIEWER_URL}>
          Launch workspace <span aria-hidden="true">↗</span>
        </a>
      </nav>

      <section className="landing-hero" id="main-content" tabIndex={-1}>
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">
            <span /> Local mobile runtime · iOS Simulator
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

        <article className="landing-chapter landing-chapter-reverse" id="gestures">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">03 / MULTI-GESTURE FLOWS</p>
            <h2>Test motion, not just destinations.</h2>
            <p>Compose swipes, edge navigation, taps, waits, and evidence checkpoints. Run them in order, stop safely, then save useful flows to a local reusable library.</p>
            <ul><li>Pull-to-refresh and carousel presets</li><li>Leading-edge iOS navigation</li><li>Per-step failure and cancellation</li></ul>
          </div>
          <GestureVisual />
        </article>

        <article className="landing-chapter" id="evidence">
          <div className="landing-chapter-copy">
            <p className="landing-section-index">04 / REPLAYABLE EVIDENCE</p>
            <h2>A failure should explain itself.</h2>
            <p>Every action can be paired with screenshots, video markers, CPU, memory, trace events, and artifact integrity. The handoff view turns that record into reproducible next commands.</p>
            <ul><li>Action-to-artifact correlation</li><li>Visual diff and replay tools</li><li>Portable artifact health reports</li></ul>
          </div>
          <EvidenceVisual />
        </article>
      </section>

      <section className="landing-evidence" id="atlas">
        <div className="landing-evidence-copy">
          <p className="landing-section-index">05 / ATLAS RUNTIME MAP</p>
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
        <a href={GITHUB_URL} target="_blank" rel="noreferrer">Apache-2.0 · GitHub</a>
      </footer>
    </main>
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

function GestureVisual() {
  const steps = ["Swipe up", "Wait for layout", "Navigate back", "Capture checkpoint"];
  return (
    <div className="landing-feature-visual gesture-visual" aria-label="Multi-gesture flow preview">
      <div className="feature-visual-bar"><span>FLOW LIBRARY / CHECKOUT RECOVERY</span><small>4 STEPS</small></div>
      <ol>
        {steps.map((step, index) => <li key={step}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{step}</strong><small>{index === 2 ? "edgeGesture · left" : index === 1 ? "wait · 500ms" : index === 3 ? "screenshot" : "swipe · 320ms"}</small></span><i /></li>)}
      </ol>
      <div className="gesture-visual-footer"><span>Saved in this browser</span><button type="button" tabIndex={-1}>RUN FLOW →</button></div>
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

function HeroWorkbench() {
  const steps = [
    { label: "Launch CommerceDemo", meta: "1.4s", state: "passed" },
    { label: "Open the cart", meta: "0.8s", state: "passed" },
    { label: "Continue to checkout", meta: "1.1s", state: "passed" },
    { label: "Confirm the order", meta: "running", state: "running" }
  ];

  return (
    <div className="landing-workbench" aria-label="Atlas Loop product preview">
      <div className="landing-workbench-topbar">
        <div><span className="window-dot" /><span className="window-dot" /><span className="window-dot" /></div>
        <p>checkout-handoff</p>
        <span className="preview-status">Live</span>
      </div>
      <div className="landing-workbench-body">
        <div className="preview-device-column">
          <div className="preview-device">
            <div className="preview-island" />
            <div className="preview-app-bar"><span>Checkout</span><small>Secure</small></div>
            <div className="preview-order-card">
              <span>ORDER SUMMARY</span>
              <strong>Canvas Weekender</strong>
              <p>Natural canvas · one size</p>
              <div><span>Total</span><strong>$84</strong></div>
            </div>
            <div className="preview-device-action">Place order</div>
            <span className="preview-tap-target" />
          </div>
        </div>
        <div className="preview-steps-column">
          <div className="preview-run-heading">
            <div><small>OBSERVED FLOW</small><strong>Checkout still works</strong></div>
            <span>3 / 4</span>
          </div>
          <div className="preview-progress"><span /></div>
          <div className="preview-step-list">
            {steps.map((step, index) => (
              <div className={`preview-step ${step.state}`} key={step.label}>
                <span>{index + 1}</span>
                <div><strong>{step.label}</strong><small>{step.meta}</small></div>
                <i aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="preview-evidence-bar">
            <span>7 screenshots</span><span>trace.jsonl</span><span>CPU 4.7%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
