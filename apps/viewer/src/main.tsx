import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/funnel-display";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/public-sans";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import { App } from "./App.js";
import { LandingPage } from "./LandingPage.js";
import { shouldShowViewer } from "./routeMode.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Atlas Loop viewer root was not found.");
}

const hasViewerParams = shouldShowViewer(window.location.search);

createRoot(root).render(
  <StrictMode>
    {hasViewerParams ? <App /> : <LandingPage />}
  </StrictMode>
);
