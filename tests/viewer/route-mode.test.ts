import { describe, expect, it } from "vitest";
import { shouldShowViewer } from "../../apps/viewer/src/routeMode.js";

describe("shouldShowViewer", () => {
  it("keeps the root URL as the landing page", () => {
    expect(shouldShowViewer("")).toBe(false);
    expect(shouldShowViewer("?utm_source=github#workflow")).toBe(false);
  });

  it.each(["daemonUrl", "sessionId", "view", "workspace", "actionId", "artifactId"])(
    "preserves existing viewer deep links containing %s",
    (key) => {
      expect(shouldShowViewer(`?${key}=`)).toBe(true);
    }
  );
});
