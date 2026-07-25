import { describe, expect, it } from "vitest";
import {
  alignNetworkExchanges,
  exchangeLabel,
  filterNetworkExchanges,
  formatDuration,
  isSensitiveHeader,
  networkTone,
  redactHeaders,
  summariseNetworkExchanges,
  type NetworkExchange
} from "../../packages/protocol/src/networkCapture.js";

const BASE = Date.parse("2026-07-25T10:00:00.000Z");

function exchange(id: string, overrides: Partial<NetworkExchange> = {}): NetworkExchange {
  return {
    id,
    startedAt: new Date(BASE).toISOString(),
    method: "GET",
    scheme: "https",
    host: "api.example.com",
    port: 443,
    path: "/v1/catalog",
    status: 200,
    requestBytes: 120,
    responseBytes: 4096,
    durationMs: 180,
    ...overrides
  };
}

describe("redacting credentials", () => {
  it("keeps the header name and drops the value", () => {
    // Knowing a request carried an Authorization header is often the answer;
    // the token itself must never reach an artifact on disk.
    const { headers, redacted } = redactHeaders({
      Authorization: "Bearer sk-live-abc123",
      Cookie: "session=zzz",
      "Content-Type": "application/json"
    });

    expect(headers).toEqual({
      Authorization: "<redacted>",
      Cookie: "<redacted>",
      "Content-Type": "application/json"
    });
    expect(redacted).toEqual(["Authorization", "Cookie"]);
  });

  it("does not care how a header was cased or repeated", () => {
    const { headers, redacted } = redactHeaders({
      "SET-COOKIE": ["a=1", "b=2"],
      "x-Api-Key": "k",
      Accept: ["application/json", "text/plain"]
    });

    expect(headers["SET-COOKIE"]).toBe("<redacted>");
    expect(headers["x-Api-Key"]).toBe("<redacted>");
    expect(headers.Accept).toBe("application/json, text/plain");
    expect(redacted).toHaveLength(2);
  });

  it("drops headers that were never sent rather than inventing them", () => {
    const { headers, redacted } = redactHeaders({ Accept: undefined, Host: "api.example.com" });

    expect(headers).toEqual({ Host: "api.example.com" });
    expect(redacted).toEqual([]);
  });

  it("names the headers it treats as credentials", () => {
    expect(isSensitiveHeader("  AUTHORIZATION ")).toBe(true);
    expect(isSensitiveHeader("proxy-authorization")).toBe(true);
    expect(isSensitiveHeader("content-type")).toBe(false);
  });
});

describe("how an exchange reads", () => {
  it("separates a refused request from one that never arrived", () => {
    // A 500 means the server answered. No response at all means the app does
    // not even know what happened, which is worse.
    expect(networkTone(exchange("a", { status: 200 }))).toBe("good");
    expect(networkTone(exchange("b", { status: 404 }))).toBe("warn");
    expect(networkTone(exchange("c", { status: 503 }))).toBe("bad");
    expect(networkTone(exchange("d", { status: undefined, error: "ECONNREFUSED" }))).toBe("bad");
  });

  it("does not judge an exchange it could not read", () => {
    expect(networkTone(exchange("e", { status: undefined, tunnelled: true }))).toBe("neutral");
  });

  it("labels a tunnel by host and port, since it has no path", () => {
    expect(exchangeLabel(exchange("f"))).toBe("api.example.com/v1/catalog");
    expect(exchangeLabel(exchange("g", { tunnelled: true, path: "" }))).toBe("api.example.com:443");
  });
});

describe("summarising a capture", () => {
  const exchanges = [
    exchange("a", { durationMs: 120 }),
    exchange("b", { host: "cdn.example.com", status: 404, durationMs: 90, responseBytes: 20 }),
    exchange("c", { status: undefined, error: "socket hang up", durationMs: undefined }),
    exchange("d", { host: "metrics.example.com", tunnelled: true, status: undefined, durationMs: 1400 })
  ];

  it("counts what went wrong two different ways", () => {
    const summary = summariseNetworkExchanges(exchanges);

    // A server that answered 404 is not the same failure as never reaching one.
    expect(summary).toMatchObject({ total: 4, failed: 1, errors: 1, tunnelled: 1 });
  });

  it("names the slowest exchange, not just its duration", () => {
    const summary = summariseNetworkExchanges(exchanges);

    expect(summary.slowestMs).toBe(1400);
    expect(summary.slowest?.id).toBe("d");
  });

  it("lists the hosts the app talked to", () => {
    expect(summariseNetworkExchanges(exchanges).hosts).toEqual([
      "api.example.com",
      "cdn.example.com",
      "metrics.example.com"
    ]);
  });

  it("adds up bytes in both directions", () => {
    const summary = summariseNetworkExchanges(exchanges);

    expect(summary.requestBytes).toBe(480);
    expect(summary.responseBytes).toBe(4096 * 3 + 20);
  });

  it("reports an empty capture without inventing a slowest", () => {
    expect(summariseNetworkExchanges([])).toMatchObject({ total: 0, hosts: [], slowestMs: undefined });
  });

  it("ignores a timestamp it cannot read when bounding the capture", () => {
    const summary = summariseNetworkExchanges([
      exchange("a", { startedAt: "not-a-date" }),
      exchange("b", { startedAt: new Date(BASE + 5000).toISOString() })
    ]);

    expect(summary.firstAt).toBe(new Date(BASE + 5000).toISOString());
    expect(summary.total).toBe(2);
  });
});

describe("filtering a capture", () => {
  const exchanges = [
    exchange("a", { method: "GET", path: "/v1/catalog", status: 200 }),
    exchange("b", { method: "POST", path: "/v1/orders", status: 500 }),
    exchange("c", { host: "cdn.example.com", status: undefined, error: "timeout" }),
    exchange("d", { host: "metrics.example.com", tunnelled: true, status: undefined })
  ];

  it("narrows to problems, which means refused or unanswered", () => {
    expect(filterNetworkExchanges(exchanges, { kind: "problems" }).map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("narrows to what it could not read inside", () => {
    expect(filterNetworkExchanges(exchanges, { kind: "tunnelled" }).map((e) => e.id)).toEqual(["d"]);
  });

  it("matches over method, host, path, status, and error", () => {
    expect(filterNetworkExchanges(exchanges, { search: "orders" }).map((e) => e.id)).toEqual(["b"]);
    expect(filterNetworkExchanges(exchanges, { search: "TIMEOUT" }).map((e) => e.id)).toEqual(["c"]);
    expect(filterNetworkExchanges(exchanges, { search: "500" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("narrows by host and method", () => {
    expect(filterNetworkExchanges(exchanges, { host: "CDN.example.com" }).map((e) => e.id)).toEqual(["c"]);
    expect(filterNetworkExchanges(exchanges, { method: "post" }).map((e) => e.id)).toEqual(["b"]);
  });

  it("returns everything when nothing is asked for", () => {
    expect(filterNetworkExchanges(exchanges)).toHaveLength(4);
    expect(filterNetworkExchanges(exchanges, { search: "  ", kind: "all" })).toHaveLength(4);
  });
});

describe("attributing exchanges to steps", () => {
  const windows = [
    { actionId: "act_1", startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE + 2000).toISOString() },
    { actionId: "act_2", startedAt: new Date(BASE + 3000).toISOString(), endedAt: new Date(BASE + 5000).toISOString() }
  ];

  it("credits a request to the step that issued it", () => {
    const aligned = alignNetworkExchanges(
      [
        exchange("a", { startedAt: new Date(BASE + 500).toISOString() }),
        exchange("b", { startedAt: new Date(BASE + 3500).toISOString() })
      ],
      windows
    );

    expect(aligned.steps).toEqual([
      { actionId: "act_1", exchanges: [expect.objectContaining({ id: "a" })] },
      { actionId: "act_2", exchanges: [expect.objectContaining({ id: "b" })] }
    ]);
  });

  it("keeps a slow request with the step that started it", () => {
    // Attributing by completion would credit a call that outlived its step to
    // whatever happened to be running when it finally came back.
    const aligned = alignNetworkExchanges(
      [
        exchange("slow", {
          startedAt: new Date(BASE + 1000).toISOString(),
          endedAt: new Date(BASE + 4500).toISOString(),
          durationMs: 3500
        })
      ],
      windows
    );

    expect(aligned.steps[0]).toMatchObject({ actionId: "act_1" });
  });

  it("leaves a request that belongs to no step unattributed", () => {
    const aligned = alignNetworkExchanges(
      [exchange("between", { startedAt: new Date(BASE + 2500).toISOString() })],
      windows
    );

    expect(aligned.steps).toEqual([]);
    expect(aligned.unattributed.map((e) => e.id)).toEqual(["between"]);
  });

  it("does not drop an exchange whose timestamp cannot be read", () => {
    const aligned = alignNetworkExchanges([exchange("broken", { startedAt: "nope" })], windows);

    expect(aligned.unattributed.map((e) => e.id)).toEqual(["broken"]);
  });

  it("gives a nested step its own calls", () => {
    const nested = [
      { actionId: "outer", startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE + 9000).toISOString() },
      { actionId: "inner", startedAt: new Date(BASE + 2000).toISOString(), endedAt: new Date(BASE + 4000).toISOString() }
    ];
    const aligned = alignNetworkExchanges(
      [exchange("x", { startedAt: new Date(BASE + 3000).toISOString() })],
      nested
    );

    expect(aligned.steps[0]).toMatchObject({ actionId: "inner" });
  });

  it("keeps a still-running step open-ended", () => {
    const open = [{ actionId: "running", startedAt: new Date(BASE).toISOString() }];
    const aligned = alignNetworkExchanges(
      [exchange("late", { startedAt: new Date(BASE + 900_000).toISOString() })],
      open
    );

    expect(aligned.steps[0]).toMatchObject({ actionId: "running" });
  });
});

describe("formatting a duration", () => {
  it("reads on both sides of a second", () => {
    expect(formatDuration(842)).toBe("842ms");
    expect(formatDuration(2400)).toBe("2.4s");
  });

  it("refuses to render a duration it does not have", () => {
    expect(formatDuration(undefined)).toBe("--");
    expect(formatDuration(Number.NaN)).toBe("--");
    expect(formatDuration(-5)).toBe("--");
  });
});
