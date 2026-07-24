import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAEMON_URL,
  DEFAULT_SESSION_ID,
  buildSessionHistoryUrl,
  buildSessionsUrl,
  buildSessionUrl,
  readViewerParams,
  writeViewerSearch
} from "../../apps/viewer/src/viewerParams.js";

describe("viewer params", () => {
  it("uses local daemon and latest session defaults", () => {
    expect(readViewerParams("")).toEqual({
      daemonUrl: DEFAULT_DAEMON_URL,
      sessionId: DEFAULT_SESSION_ID
    });
  });

  it("normalizes daemonUrl and sessionId from query params", () => {
    expect(readViewerParams("?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317%2F&sessionId=session_123")).toEqual({
      daemonUrl: "http://127.0.0.1:4317",
      sessionId: "session_123"
    });
  });

  it("normalizes the optional local viewer base URL without serializing it", () => {
    expect(readViewerParams("?sessionId=session_123", "http://127.0.0.1:5176/path?x=1#hash")).toEqual({
      daemonUrl: DEFAULT_DAEMON_URL,
      sessionId: "session_123",
      viewerBaseUrl: "http://127.0.0.1:5176/path"
    });
  });

  it("builds encoded session endpoints", () => {
    expect(buildSessionsUrl("http://127.0.0.1:4317/")).toBe("http://127.0.0.1:4317/v1/sessions");
    expect(buildSessionHistoryUrl("http://127.0.0.1:4317/", 30)).toBe("http://127.0.0.1:4317/v1/sessions/history?limit=30");
    expect(buildSessionHistoryUrl("http://127.0.0.1:4317/")).toBe("http://127.0.0.1:4317/v1/sessions/history");

    expect(buildSessionUrl({ daemonUrl: "http://127.0.0.1:4317", sessionId: "run/one" }, "latest-screenshot")).toBe(
      "http://127.0.0.1:4317/v1/sessions/run%2Fone/latest-screenshot"
    );
  });

  it("serializes query params for browser history", () => {
    expect(writeViewerSearch({ daemonUrl: "http://127.0.0.1:4317/", sessionId: "abc" })).toBe(
      "?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=abc"
    );
  });

  it("round-trips full workspace surfaces and defaults to evidence", () => {
    const search = writeViewerSearch({
      daemonUrl: DEFAULT_DAEMON_URL,
      sessionId: "sess_triage",
      workspace: "overview"
    });

    expect(search).toContain("workspace=overview");
    expect(readViewerParams(search).workspace).toBe("overview");
    expect(readViewerParams("?workspace=evidence").workspace).toBeUndefined();
    expect(readViewerParams("?workspace=unknown").workspace).toBeUndefined();
    expect(writeViewerSearch({ daemonUrl: DEFAULT_DAEMON_URL, sessionId: "sess_triage", workspace: "evidence" })).not.toContain("workspace=");

    const workflows = writeViewerSearch({ daemonUrl: DEFAULT_DAEMON_URL, sessionId: "sess_triage", workspace: "workflows" });
    expect(workflows).toContain("workspace=workflows");
    expect(readViewerParams(workflows).workspace).toBe("workflows");

    const apps = writeViewerSearch({ daemonUrl: DEFAULT_DAEMON_URL, sessionId: "sess_triage", workspace: "apps" });
    expect(apps).toContain("workspace=apps");
    expect(readViewerParams(apps).workspace).toBe("apps");

    const sessions = writeViewerSearch({ daemonUrl: DEFAULT_DAEMON_URL, sessionId: "sess_triage", workspace: "sessions" });
    expect(sessions).toContain("workspace=sessions");
    expect(readViewerParams(sessions).workspace).toBe("sessions");

    const tests = writeViewerSearch({ daemonUrl: DEFAULT_DAEMON_URL, sessionId: "sess_triage", workspace: "tests" });
    expect(tests).toContain("workspace=tests");
    expect(readViewerParams(tests).workspace).toBe("tests");
  });
});
