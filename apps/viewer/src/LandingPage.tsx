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
          <a href="#workflow">Workflow</a>
          <a href="#evidence">Evidence</a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <a className="landing-nav-cta" href={VIEWER_URL}>
          Open viewer
        </a>
      </nav>

      <section className="landing-hero" id="main-content" tabIndex={-1}>
        <div className="landing-hero-copy">
          <p className="landing-eyebrow">
            <span /> Local-first iOS verification
          </p>
          <h1>Let agents prove the app still works.</h1>
          <p className="landing-lede">
            Drive real Simulator flows, inspect every observed step, and keep screenshots, traces, metrics, and failures as durable local evidence.
          </p>
          <div className="landing-actions">
            <a className="landing-primary-action" href={VIEWER_URL}>
              Open the evidence viewer <span aria-hidden="true">→</span>
            </a>
            <a className="landing-secondary-action" href={GITHUB_URL} target="_blank" rel="noreferrer">
              View source
            </a>
          </div>
          <div className="landing-proof-line" aria-label="Product properties">
            <span>Runs on your Mac</span>
            <span>Evidence stays local</span>
            <span>CLI and MCP</span>
          </div>
        </div>

        <HeroWorkbench />
      </section>

      <section className="landing-manifesto" id="workflow">
        <p className="landing-section-index">01 / The loop</p>
        <div>
          <h2>Stop debugging the test harness.</h2>
          <p>
            Atlas Loop records what the agent did and what the app showed. A failed run carries the screen, action, trace, artifact health, and handoff commands needed to continue—not a brittle selector mystery.
          </p>
        </div>
      </section>

      <section className="landing-workflow" aria-label="Atlas Loop workflow">
        <article>
          <span>01</span>
          <h3>Drive</h3>
          <p>Build, launch, tap, type, swipe, and assert against a real iOS Simulator session.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Observe</h3>
          <p>Pair each action with screenshots, results, video markers, CPU, RSS, and trace events.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Hand off</h3>
          <p>Export a verifiable local bundle another human or coding agent can inspect without guesswork.</p>
        </article>
      </section>

      <section className="landing-evidence" id="evidence">
        <div className="landing-evidence-copy">
          <p className="landing-section-index">02 / Store of record</p>
          <h2>Every flow leaves a map.</h2>
          <p>
            The Atlas view derives screens and transitions from evidence already captured during a run. Deep links reconnect a map edge to the exact session, action, and artifact that produced it.
          </p>
          <a href={VIEWER_URL}>Inspect a local session →</a>
        </div>
        <div className="landing-map-visual" aria-label="Example evidence map">
          <div className="map-node map-node-a"><span>Cart</span><small>3 actions</small></div>
          <div className="map-route map-route-a" />
          <div className="map-node map-node-b"><span>Checkout</span><small>5 actions</small></div>
          <div className="map-route map-route-b" />
          <div className="map-node map-node-c"><span>Confirmation</span><small>assert visible</small></div>
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
