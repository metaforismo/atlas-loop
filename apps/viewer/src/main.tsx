import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/funnel-display";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/public-sans";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import { shouldShowViewer } from "./routeMode.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Atlas Loop viewer root was not found.");
}

const hasViewerParams = shouldShowViewer(window.location.search);
const RoutedSurface = hasViewerParams
  ? lazy(() => import("./App.js").then(({ App }) => ({ default: App })))
  : lazy(() => import("./LandingPage.js").then(({ LandingPage }) => ({ default: LandingPage })));

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={<RouteBootStatus viewer={hasViewerParams} />}>
      <RoutedSurface />
    </Suspense>
  </StrictMode>
);

function RouteBootStatus({ viewer }: { viewer: boolean }) {
  return (
    <main className="route-boot-status" aria-live="polite" aria-busy="true">
      <img src="/atlas-loop-mark.png" alt="" aria-hidden="true" />
      <span>Atlas Loop</span>
      <strong>{viewer ? "Opening local workspace" : "Loading product surface"}</strong>
      <i aria-hidden="true" />
    </main>
  );
}
