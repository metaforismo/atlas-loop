import { describe, expect, it } from "vitest";
import {
  alignDeviceLogs,
  filterDeviceLogs,
  normaliseLogTimestamp,
  parseDeviceLogLine,
  summariseDeviceLogs,
  type DeviceLogEntry,
  type DeviceLogWindow
} from "../../packages/protocol/src/index.js";

/** A real line from `log stream --style ndjson`, trimmed to the fields used. */
function ndjson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2026-07-25 12:06:54.348781+0200",
    messageType: "Default",
    eventType: "logEvent",
    subsystem: "com.apple.WiFiManager",
    category: "net",
    processImagePath: "/usr/libexec/airportd",
    processID: 1234,
    eventMessage: "isInfraRealtimePacketThreshold",
    ...overrides
  });
}

function entry(at: string, overrides: Partial<DeviceLogEntry> = {}): DeviceLogEntry {
  return {
    schemaVersion: "atlas-loop.device-log.v1",
    at,
    level: "default",
    message: "message",
    ...overrides
  };
}

describe("device log timestamps", () => {
  it("normalises the non-ISO format the log stream actually emits", () => {
    // `2026-07-25 12:06:54.348781+0200` uses a space and an offset with no
    // colon. V8 tolerates it; other engines need not, and these travel to a
    // browser, so they are normalised once at capture.
    const at = normaliseLogTimestamp("2026-07-25 12:06:54.348781+0200");

    expect(at).toBe("2026-07-25T10:06:54.348Z");
    expect(Number.isFinite(Date.parse(at!))).toBe(true);
  });

  it("handles negative and zero offsets", () => {
    expect(normaliseLogTimestamp("2026-07-25 12:06:54.000000-0700")).toBe("2026-07-25T19:06:54.000Z");
    expect(normaliseLogTimestamp("2026-07-25 12:06:54.000000+0000")).toBe("2026-07-25T12:06:54.000Z");
  });

  it("accepts a value that is already ISO", () => {
    expect(normaliseLogTimestamp("2026-07-25T10:06:54.348Z")).toBe("2026-07-25T10:06:54.348Z");
  });

  it("returns nothing for anything unusable", () => {
    for (const bad of ["", "   ", "not a date", undefined, null, 42, {}]) {
      expect(normaliseLogTimestamp(bad)).toBeUndefined();
    }
  });
});

describe("device log parsing", () => {
  it("parses a real ndjson event", () => {
    expect(parseDeviceLogLine(ndjson())).toMatchObject({
      schemaVersion: "atlas-loop.device-log.v1",
      at: "2026-07-25T10:06:54.348Z",
      level: "default",
      subsystem: "com.apple.WiFiManager",
      category: "net",
      process: "airportd",
      processId: 1234,
      message: "isInfraRealtimePacketThreshold"
    });
  });

  it("skips the human banner the stream opens with", () => {
    // The first line of output is not JSON at all.
    expect(parseDeviceLogLine('Filtering the log data using "process == \\"CommerceDemo\\""')).toBeUndefined();
    expect(parseDeviceLogLine("")).toBeUndefined();
    expect(parseDeviceLogLine("   ")).toBeUndefined();
  });

  it("skips malformed JSON rather than throwing", () => {
    expect(parseDeviceLogLine('{"timestamp": "2026-07-25 12:06:54.000000+0000"')).toBeUndefined();
  });

  it("skips records with no usable timestamp or no message", () => {
    expect(parseDeviceLogLine(ndjson({ timestamp: "nope" }))).toBeUndefined();
    expect(parseDeviceLogLine(ndjson({ eventMessage: "" }))).toBeUndefined();
    expect(parseDeviceLogLine(ndjson({ eventMessage: undefined }))).toBeUndefined();
  });

  it("maps every message type, and falls back rather than dropping", () => {
    expect(parseDeviceLogLine(ndjson({ messageType: "Error" }))?.level).toBe("error");
    expect(parseDeviceLogLine(ndjson({ messageType: "Fault" }))?.level).toBe("fault");
    expect(parseDeviceLogLine(ndjson({ messageType: "Debug" }))?.level).toBe("debug");
    expect(parseDeviceLogLine(ndjson({ messageType: "Info" }))?.level).toBe("info");
    expect(parseDeviceLogLine(ndjson({ messageType: "Something new" }))?.level).toBe("default");
  });

  it("treats blank subsystem and category as absent", () => {
    const parsed = parseDeviceLogLine(ndjson({ subsystem: "", category: "  " }));

    expect(parsed?.subsystem).toBeUndefined();
    expect(parsed?.category).toBeUndefined();
  });
});

describe("aligning logs to steps", () => {
  const windows: DeviceLogWindow[] = [
    { actionId: "act_1", kind: "tap", sequence: 1, startedAt: "2026-07-25T10:00:00.000Z", endedAt: "2026-07-25T10:00:05.000Z" },
    { actionId: "act_2", kind: "assertVisible", sequence: 2, startedAt: "2026-07-25T10:00:10.000Z", endedAt: "2026-07-25T10:00:20.000Z" }
  ];

  it("puts each entry in the step that was running", () => {
    const aligned = alignDeviceLogs(
      [entry("2026-07-25T10:00:02.000Z", { message: "during one" }), entry("2026-07-25T10:00:15.000Z", { message: "during two" })],
      windows
    );

    expect(aligned.steps.map((step) => step.actionId)).toEqual(["act_1", "act_2"]);
    expect(aligned.steps[0]!.entries[0]!.message).toBe("during one");
    expect(aligned.steps[1]!.entries[0]!.message).toBe("during two");
    expect(aligned.unattributed).toEqual([]);
  });

  it("keeps entries logged between steps separate from any step", () => {
    // "logged between steps" is a different claim from "logged during step 2".
    const aligned = alignDeviceLogs(
      [
        entry("2026-07-25T09:59:59.000Z", { message: "before" }),
        entry("2026-07-25T10:00:07.000Z", { message: "between" }),
        entry("2026-07-25T10:00:30.000Z", { message: "after" })
      ],
      windows
    );

    expect(aligned.steps).toEqual([]);
    expect(aligned.unattributed.map((item) => item.message)).toEqual(["before", "between", "after"]);
  });

  it("treats window boundaries as inclusive", () => {
    const aligned = alignDeviceLogs(
      [entry("2026-07-25T10:00:00.000Z"), entry("2026-07-25T10:00:05.000Z")],
      windows
    );

    expect(aligned.steps[0]!.entries).toHaveLength(2);
    expect(aligned.unattributed).toEqual([]);
  });

  it("leaves a still-running action's window open-ended", () => {
    const aligned = alignDeviceLogs([entry("2026-07-25T23:00:00.000Z")], [
      { actionId: "act_live", startedAt: "2026-07-25T10:00:00.000Z" }
    ]);

    expect(aligned.steps[0]?.actionId).toBe("act_live");
  });

  it("attributes to the innermost step when windows overlap", () => {
    // A retried or nested action should not steal lines for its parent.
    const aligned = alignDeviceLogs([entry("2026-07-25T10:00:12.000Z")], [
      { actionId: "outer", startedAt: "2026-07-25T10:00:00.000Z", endedAt: "2026-07-25T10:00:30.000Z" },
      { actionId: "inner", startedAt: "2026-07-25T10:00:10.000Z", endedAt: "2026-07-25T10:00:20.000Z" }
    ]);

    expect(aligned.steps).toHaveLength(1);
    expect(aligned.steps[0]!.actionId).toBe("inner");
  });

  it("reports steps in window order, not in the order entries arrived", () => {
    const aligned = alignDeviceLogs(
      [entry("2026-07-25T10:00:15.000Z"), entry("2026-07-25T10:00:02.000Z")],
      windows
    );

    expect(aligned.steps.map((step) => step.actionId)).toEqual(["act_1", "act_2"]);
  });

  it("does not invent a step for an unusable timestamp on either side", () => {
    expect(alignDeviceLogs([entry("nope")], windows).unattributed).toHaveLength(1);
    expect(alignDeviceLogs([entry("2026-07-25T10:00:02.000Z")], [{ actionId: "bad", startedAt: "nope" }]).unattributed).toHaveLength(1);
  });

  it("handles empty inputs", () => {
    expect(alignDeviceLogs([], windows)).toEqual({ steps: [], unattributed: [] });
    expect(alignDeviceLogs([entry("2026-07-25T10:00:02.000Z")], []).unattributed).toHaveLength(1);
  });
});

describe("summary and filtering", () => {
  const entries = [
    entry("2026-07-25T10:00:01.000Z", { level: "error", message: "socket failed", subsystem: "com.example.net" }),
    entry("2026-07-25T10:00:03.000Z", { level: "fault", message: "assertion" }),
    entry("2026-07-25T10:00:02.000Z", { level: "info", message: "started", process: "CommerceDemo" })
  ];

  it("counts levels and reports the window, regardless of arrival order", () => {
    const summary = summariseDeviceLogs(entries);

    expect(summary.total).toBe(3);
    expect(summary.byLevel.error).toBe(1);
    expect(summary.byLevel.fault).toBe(1);
    expect(summary.problems).toBe(2);
    expect(summary.firstAt).toBe("2026-07-25T10:00:01.000Z");
    expect(summary.lastAt).toBe("2026-07-25T10:00:03.000Z");
  });

  it("reports zeros rather than undefined for an empty capture", () => {
    const summary = summariseDeviceLogs([]);

    expect(summary.total).toBe(0);
    expect(summary.problems).toBe(0);
    expect(summary.firstAt).toBeUndefined();
  });

  it("searches message, subsystem, process, and level", () => {
    expect(filterDeviceLogs(entries, "socket")).toHaveLength(1);
    expect(filterDeviceLogs(entries, "com.example")).toHaveLength(1);
    expect(filterDeviceLogs(entries, "commercedemo")).toHaveLength(1);
    expect(filterDeviceLogs(entries, "fault")).toHaveLength(1);
    expect(filterDeviceLogs(entries, "")).toHaveLength(3);
    expect(filterDeviceLogs(entries, "   ")).toHaveLength(3);
    expect(filterDeviceLogs(entries, "nothing here")).toHaveLength(0);
  });
});
