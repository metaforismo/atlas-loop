import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { connect as tlsConnect } from "node:tls";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createCertificateMinter,
  firstMediaType,
  hostHeader,
  loadLocalCertificateAuthority,
  parseAbsoluteTarget,
  startNetworkProxy,
  trustCertificateArgs,
  type NetworkProxyHandle
} from "../../apps/daemon/src/networkProxy.js";

const dirs: string[] = [];
const closers: Array<() => Promise<void> | void> = [];

/**
 * One CA for every test that just needs a working proxy.
 *
 * Creating a CA shells out to openssl for two RSA-2048 keygens. Doing that per
 * test meant regenerating them eighteen times a run, which is slow enough that
 * a loaded machine pushed a test past its timeout — the suite was flaky for a
 * reason that had nothing to do with what it was testing. The tests that are
 * *about* CA creation still get their own fresh directory.
 */
let sharedCaDir: string;

beforeAll(async () => {
  sharedCaDir = await mkdtemp(join(tmpdir(), "atlas-proxy-shared-ca-"));
  await loadLocalCertificateAuthority(sharedCaDir);
}, 60000);

afterAll(async () => {
  if (sharedCaDir) await rm(sharedCaDir, { recursive: true, force: true });
});

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function caDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "atlas-proxy-ca-"));
  dirs.push(dir);
  return dir;
}

/** A plain-HTTP origin the proxy can forward to. */
async function origin(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<number> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as { port: number }).port;
}

/** One request through the proxy, in the absolute form a proxied client sends. */
function proxied(
  proxy: NetworkProxyHandle,
  url: string,
  method = "GET",
  headers: Record<string, string> = {},
  body?: string
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port: proxy.port, method, path: url, headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function proxy(dir: string, overrides: Record<string, unknown> = {}): Promise<NetworkProxyHandle> {
  const handle = await startNetworkProxy({ caDir: dir, currentActionId: () => "act_1", ...overrides });
  closers.push(() => handle.close());
  return handle;
}

/** The shared CA, for tests that only need the proxy to work. */
function sharedCa(): string {
  return sharedCaDir;
}

describe("parsing what a proxied client sends", () => {
  it("reads an absolute request URL", () => {
    expect(parseAbsoluteTarget("http://api.example.com/v1/orders?x=1")).toEqual({
      scheme: "http",
      host: "api.example.com",
      port: 80,
      path: "/v1/orders?x=1"
    });
    expect(parseAbsoluteTarget("https://api.example.com:8443/a")).toMatchObject({ scheme: "https", port: 8443 });
  });

  it("refuses an origin-form URL, which was not meant for a proxy", () => {
    expect(parseAbsoluteTarget("/v1/orders")).toBeUndefined();
    expect(parseAbsoluteTarget("ws://api.example.com")).toBeUndefined();
    expect(parseAbsoluteTarget("http://")).toBeUndefined();
  });

  it("omits a standard port from the Host header", () => {
    expect(hostHeader({ scheme: "https", host: "api.example.com", port: 443 })).toBe("api.example.com");
    expect(hostHeader({ scheme: "http", host: "api.example.com", port: 80 })).toBe("api.example.com");
    expect(hostHeader({ scheme: "https", host: "api.example.com", port: 8443 })).toBe("api.example.com:8443");
  });

  it("reads a media type without its parameters", () => {
    expect(firstMediaType("application/json; charset=utf-8")).toBe("application/json");
    expect(firstMediaType(["text/html", "text/plain"])).toBe("text/html");
    expect(firstMediaType(undefined)).toBeUndefined();
  });
});

describe("the local certificate authority", () => {
  it("creates a CA and a reusable leaf key on first use", async () => {
    const dir = await caDir();
    const ca = await loadLocalCertificateAuthority(dir);

    expect(ca.cert).toContain("BEGIN CERTIFICATE");
    expect(ca.key).toContain("PRIVATE KEY");
    expect(ca.leafKey).toContain("PRIVATE KEY");
  });

  it("reuses the CA it already made, so trust survives a restart", async () => {
    // Minting a new CA per run would leave every simulator trusting a
    // certificate the daemon no longer has.
    const dir = await caDir();
    const first = await loadLocalCertificateAuthority(dir);
    const second = await loadLocalCertificateAuthority(dir);

    expect(second.cert).toBe(first.cert);
    expect(second.leafKey).toBe(first.leafKey);
  });

  it("mints one certificate per host and caches it", async () => {
    const dir = await caDir();
    const mint = createCertificateMinter(await loadLocalCertificateAuthority(dir), dir);

    const [a, again, b] = await Promise.all([
      mint("api.example.com"),
      mint("api.example.com"),
      mint("cdn.example.com")
    ]);

    expect(a).toContain("BEGIN CERTIFICATE");
    expect(again).toBe(a);
    expect(b).not.toBe(a);
  });

  it("names the command that installs the CA into a simulator", () => {
    expect(trustCertificateArgs("UDID", "/tmp/ca.pem")).toEqual([
      "simctl",
      "keychain",
      "UDID",
      "add-root-cert",
      "/tmp/ca.pem"
    ]);
  });
});

describe("capturing plain HTTP", () => {
  it("records the method, target, status, and timing of a forwarded request", async () => {
    const port = await origin((request, response) => {
      response.writeHead(request.url === "/missing" ? 404 : 200, { "content-type": "application/json" });
      response.end("{}");
    });
    const handle = await proxy(sharedCa());

    expect(await proxied(handle, `http://127.0.0.1:${port}/v1/catalog`)).toBe(200);
    expect(await proxied(handle, `http://127.0.0.1:${port}/missing`)).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(handle.exchanges().map((exchange) => [exchange.method, exchange.path, exchange.status])).toEqual([
      ["GET", "/v1/catalog", 200],
      ["GET", "/missing", 404]
    ]);
    expect(handle.exchanges()[0]).toMatchObject({ scheme: "http", host: "127.0.0.1", mediaType: "application/json" });
  });

  it("attributes an exchange to the step that was running", async () => {
    const port = await origin((_request: IncomingMessage, response: ServerResponse) => response.end("{}"));
    const handle = await proxy(sharedCa(), { currentActionId: () => "act_checkout" });

    await proxied(handle, `http://127.0.0.1:${port}/v1/orders`, "POST", {}, "{}");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(handle.exchanges()[0]).toMatchObject({ actionId: "act_checkout", method: "POST", requestBytes: 2 });
  });

  it("never writes a credential into the capture", async () => {
    // Captures become artifacts on disk and get attached to reports, so the
    // value has to be dropped in the proxy, not on the way out.
    const port = await origin((_request, response) => {
      response.writeHead(200, { "set-cookie": "session=SECRET-COOKIE" });
      response.end("{}");
    });
    const handle = await proxy(sharedCa());

    await proxied(handle, `http://127.0.0.1:${port}/v1/me`, "GET", { Authorization: "Bearer sk-live-SECRET" });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const dump = JSON.stringify(handle.exchanges());
    expect(dump).not.toContain("sk-live-SECRET");
    expect(dump).not.toContain("SECRET-COOKIE");
    // The header name survives: that a request carried authorization is often
    // the answer, and it costs nothing to say so without the token.
    expect(handle.exchanges()[0]!.redactedHeaders).toEqual(["authorization", "set-cookie"]);
  });

  it("records a request that never reached a server", async () => {
    // Dropping it would make a broken endpoint look like a request the app
    // never made.
    const handle = await proxy(sharedCa());

    await proxied(handle, "http://127.0.0.1:1/v1/orders").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const failed = handle.exchanges()[0]!;
    expect(failed.host).toBe("127.0.0.1");
    expect(failed.status).toBeUndefined();
    expect(failed.error).toBeTruthy();
  });

  it("rejects a request that was not addressed to a proxy", async () => {
    const handle = await proxy(sharedCa());

    expect(await proxied(handle, "/v1/orders")).toBe(400);
    expect(handle.exchanges()).toEqual([]);
  });

  it("stops growing at its limit and says it was cut short", async () => {
    const port = await origin((_request: IncomingMessage, response: ServerResponse) => response.end("{}"));
    const handle = await proxy(sharedCa(), { maxExchanges: 2 });

    for (const index of [1, 2, 3, 4]) await proxied(handle, `http://127.0.0.1:${port}/r${index}`);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(handle.exchanges()).toHaveLength(2);
    expect(handle.truncated()).toBe(true);
  });
});

describe("knowing whether traffic is arriving", () => {
  it("reports nothing received before anything connects", async () => {
    // An empty capture must be explainable: routing the simulator's traffic
    // here is a separate step, and silence usually means it was not done.
    const handle = await proxy(sharedCa());

    expect(handle.receiving()).toBe(false);
    expect(handle.truncated()).toBe(false);
  });

  it("reports traffic once anything reaches the proxy", async () => {
    const port = await origin((_request: IncomingMessage, response: ServerResponse) => response.end("{}"));
    const handle = await proxy(sharedCa());

    await proxied(handle, `http://127.0.0.1:${port}/ping`);

    expect(handle.receiving()).toBe(true);
  });
});

describe("capturing HTTPS", () => {
  it("reads a request inside the tunnel and stays transparent to the client", async () => {
    const dir = sharedCa();
    const ca = await loadLocalCertificateAuthority(dir);
    const mint = createCertificateMinter(ca, dir);

    // The origin is signed by the same CA so the proxy's upstream verification
    // passes; the proxy reads the traffic without weakening the transport.
    const server = createHttpsServer({ key: ca.leafKey, cert: await mint("localhost") }, (request, response) => {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: request.url, method: request.method }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const port = (server.address() as { port: number }).port;

    // The origin's certificate comes from this CA, so the proxy is told to
    // accept it upstream; verification itself stays on.
    const handle = await proxy(dir, { upstreamCa: ca.cert });
    const raw = await new Promise<string>((resolve, reject) => {
      const request = httpRequest({ host: "127.0.0.1", port: handle.port, method: "CONNECT", path: `localhost:${port}` });
      request.on("connect", (_response, socket) => {
        const tls = tlsConnect({ socket, servername: "localhost", ca: [ca.cert] }, () => {
          tls.write(
            `POST /v1/orders HTTP/1.1\r\nHost: localhost:${port}\r\nAuthorization: Bearer sk-TLS-SECRET\r\nConnection: close\r\n\r\n`
          );
        });
        let body = "";
        tls.on("data", (chunk) => (body += chunk));
        tls.on("end", () => resolve(body));
        tls.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    // The client sees the origin's real response, unchanged.
    expect(raw).toContain("201 Created");
    expect(raw).toContain('"path":"/v1/orders"');

    expect(handle.exchanges()[0]).toMatchObject({
      method: "POST",
      scheme: "https",
      host: "localhost",
      port,
      path: "/v1/orders",
      status: 201
    });
    expect(JSON.stringify(handle.exchanges())).not.toContain("sk-TLS-SECRET");
  }, 30000);

  it("refuses an upstream server it cannot verify", async () => {
    // Reading the app's traffic must not mean accepting any certificate on the
    // app's behalf; a bad upstream certificate stays a failure.
    const dir = sharedCa();
    const ca = await loadLocalCertificateAuthority(dir);
    const server = createHttpsServer(
      { key: ca.leafKey, cert: await createCertificateMinter(ca, dir)("not-localhost") },
      (_request: IncomingMessage, response: ServerResponse) => response.end("{}")
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const port = (server.address() as { port: number }).port;

    const handle = await proxy(dir);
    await new Promise<void>((resolve) => {
      const request = httpRequest({ host: "127.0.0.1", port: handle.port, method: "CONNECT", path: `localhost:${port}` });
      request.on("connect", (_response, socket) => {
        const tls = tlsConnect({ socket, servername: "localhost", ca: [ca.cert] }, () => {
          tls.write(`GET /v1/orders HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
        });
        tls.on("data", () => undefined);
        tls.on("end", () => resolve());
        tls.on("error", () => resolve());
      });
      request.on("error", () => resolve());
      request.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const exchange = handle.exchanges()[0];
    expect(exchange?.status).toBeUndefined();
    expect(exchange?.error).toBeTruthy();
  }, 30000);
});
