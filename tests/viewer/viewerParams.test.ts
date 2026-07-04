import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAEMON_URL,
  DEFAULT_SESSION_ID,
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

  it("builds encoded session endpoints", () => {
    expect(buildSessionUrl({ daemonUrl: "http://127.0.0.1:4317", sessionId: "run/one" }, "latest-screenshot")).toBe(
      "http://127.0.0.1:4317/v1/sessions/run%2Fone/latest-screenshot"
    );
  });

  it("serializes query params for browser history", () => {
    expect(writeViewerSearch({ daemonUrl: "http://127.0.0.1:4317/", sessionId: "abc" })).toBe(
      "?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=abc"
    );
  });
});
