import { spawn } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer as createTlsServer, type TLSSocket } from "node:tls";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { Socket } from "node:net";
import { redactHeaders, type NetworkExchange } from "@atlas-loop/protocol";

/**
 * A local intercepting proxy.
 *
 * The proxy answers the question a screenshot cannot: which endpoint did the
 * app call, what came back, and how long did it block. Plain HTTP is read
 * directly. HTTPS is terminated with a certificate this daemon mints from its
 * own local CA, which `simctl keychain add-root-cert` installs into the
 * simulator's trust store — so the contents are readable without touching the
 * host's trust settings.
 *
 * The CA is local to this machine and exists only to read traffic from a
 * simulator you control. Nothing here is written to disk unredacted:
 * credential-bearing headers lose their values in the proxy, before an exchange
 * ever becomes an artifact.
 */

/** Bounds so a chatty app cannot grow a capture without limit. */
const DEFAULT_MAX_EXCHANGES = 2000;

export interface NetworkProxyOptions {
  /** Loopback port; 0 asks the OS for a free one. */
  port?: number;
  /** Directory the CA lives in, so one CA serves every session on this machine. */
  caDir: string;
  maxExchanges?: number;
  /**
   * Extra CAs the proxy will accept from upstream servers, for a run pointed at
   * a staging host with a private certificate authority. Upstream verification
   * stays on either way: reading the app's traffic must not mean accepting any
   * certificate on the app's behalf.
   */
  upstreamCa?: string | string[];
  /** The step running when a request starts, for attribution. */
  currentActionId?: () => string | undefined;
  onExchange?: (exchange: NetworkExchange) => void;
  onError?: (error: Error) => void;
  now?: () => Date;
}

export interface NetworkProxyHandle {
  url: string;
  port: number;
  caPath: string;
  exchanges: () => NetworkExchange[];
  /** True once anything at all has connected, so an empty capture is explainable. */
  receiving: () => boolean;
  truncated: () => boolean;
  close: () => Promise<void>;
}

export interface LocalCertificateAuthority {
  certPath: string;
  keyPath: string;
  leafKeyPath: string;
  cert: string;
  key: string;
  leafKey: string;
}

function run(command: string, args: string[], input?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Loads the machine's local CA, creating it on first use.
 *
 * One leaf key is generated alongside it and reused for every host. Minting a
 * fresh 2048-bit key per host costs about a second; reusing one and signing
 * only the certificate costs about a fifth of that, which is the difference
 * between a noticeable stall on each new host and none.
 */
export async function loadLocalCertificateAuthority(caDir: string): Promise<LocalCertificateAuthority> {
  const certPath = join(caDir, "atlas-loop-ca.pem");
  const keyPath = join(caDir, "atlas-loop-ca-key.pem");
  const leafKeyPath = join(caDir, "atlas-loop-leaf-key.pem");
  await mkdir(caDir, { recursive: true });

  const existing = await Promise.all([
    readFile(certPath, "utf8").catch(() => undefined),
    readFile(keyPath, "utf8").catch(() => undefined),
    readFile(leafKeyPath, "utf8").catch(() => undefined)
  ]);
  if (existing[0] && existing[1] && existing[2]) {
    return { certPath, keyPath, leafKeyPath, cert: existing[0], key: existing[1], leafKey: existing[2] };
  }

  const ca = await run("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
    "-days", "825", "-nodes",
    "-subj", "/CN=Atlas Loop Local CA/O=Atlas Loop",
    "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign"
  ]);
  if (ca.code !== 0) throw new Error(`could not create a local CA: ${ca.stderr.trim()}`);

  const leaf = await run("openssl", ["genrsa", "-out", leafKeyPath, "2048"]);
  if (leaf.code !== 0) throw new Error(`could not create a leaf key: ${leaf.stderr.trim()}`);

  return {
    certPath,
    keyPath,
    leafKeyPath,
    cert: await readFile(certPath, "utf8"),
    key: await readFile(keyPath, "utf8"),
    leafKey: await readFile(leafKeyPath, "utf8")
  };
}

/** Certificates are minted per host and cached; a run revisits the same hosts. */
export function createCertificateMinter(ca: LocalCertificateAuthority, caDir: string) {
  const cache = new Map<string, Promise<string>>();

  return (host: string): Promise<string> => {
    let pending = cache.get(host);
    if (pending) return pending;

    pending = (async () => {
      const csrPath = join(caDir, `leaf-${safeName(host)}.csr`);
      const certPath = join(caDir, `leaf-${safeName(host)}.pem`);
      const extPath = join(caDir, `leaf-${safeName(host)}.ext`);
      // An IP address has to go in as an IP SAN; a DNS SAN would not match.
      const sanKind = /^[\d.]+$/.test(host) ? "IP" : "DNS";
      await writeFile(extPath, `subjectAltName=${sanKind}:${host}\nextendedKeyUsage=serverAuth\n`, "utf8");

      const csr = await run("openssl", ["req", "-new", "-key", ca.leafKeyPath, "-out", csrPath, "-subj", `/CN=${host}`]);
      if (csr.code !== 0) throw new Error(`could not request a certificate for ${host}: ${csr.stderr.trim()}`);

      const signed = await run("openssl", [
        "x509", "-req", "-in", csrPath, "-CA", ca.certPath, "-CAkey", ca.keyPath,
        "-CAcreateserial", "-out", certPath, "-days", "825", "-extfile", extPath
      ]);
      if (signed.code !== 0) throw new Error(`could not sign a certificate for ${host}: ${signed.stderr.trim()}`);

      return readFile(certPath, "utf8");
    })();

    cache.set(host, pending);
    // A failed mint is forgotten so the next request for that host retries.
    void pending.catch(() => cache.delete(host));
    return pending;
  };
}

function safeName(host: string): string {
  return host.replace(/[^a-zA-Z0-9.-]/g, "_");
}

let exchangeCounter = 0;

/**
 * Starts the capture proxy.
 *
 * Routing the simulator's traffic here is an explicit step: the iOS Simulator
 * takes its proxy configuration from the host's network settings, and neither
 * per-app environment variables nor a per-device configuration file change
 * that. The proxy therefore reports whether anything has reached it, so an
 * empty capture is never mistaken for an app that made no requests.
 */
export async function startNetworkProxy(options: NetworkProxyOptions): Promise<NetworkProxyHandle> {
  const maxExchanges = options.maxExchanges ?? DEFAULT_MAX_EXCHANGES;
  const now = options.now ?? (() => new Date());
  const currentActionId = options.currentActionId ?? (() => undefined);
  const exchanges: NetworkExchange[] = [];
  let truncated = false;
  let receiving = false;

  const ca = await loadLocalCertificateAuthority(options.caDir);
  const mint = createCertificateMinter(ca, options.caDir);

  const record = (exchange: NetworkExchange): void => {
    if (exchanges.length >= maxExchanges) {
      truncated = true;
      return;
    }
    exchanges.push(exchange);
    options.onExchange?.(exchange);
  };

  /** Forwards one request and records what happened to it. */
  const forward = (
    request: IncomingMessage,
    response: ServerResponse,
    target: { scheme: "http" | "https"; host: string; port: number; path: string }
  ): void => {
    receiving = true;
    const startedAt = now();
    const startedMs = startedAt.getTime();
    const actionId = currentActionId();
    const requestRedaction = redactHeaders(request.headers as Record<string, string | string[] | undefined>);
    let requestBytes = 0;
    let responseBytes = 0;

    request.on("data", (chunk: Buffer) => (requestBytes += chunk.length));

    const finish = (extra: Partial<NetworkExchange>): void => {
      const endedAt = now();
      record({
        id: `net_${(exchangeCounter += 1).toString(36)}`,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedMs,
        method: request.method ?? "GET",
        scheme: target.scheme,
        host: target.host,
        port: target.port,
        path: target.path,
        requestBytes,
        responseBytes,
        requestHeaders: requestRedaction.headers,
        ...(requestRedaction.redacted.length ? { redactedHeaders: requestRedaction.redacted } : {}),
        ...(actionId ? { actionId } : {}),
        ...extra
      });
    };

    const send = target.scheme === "https" ? httpsRequest : httpRequest;
    const upstream = send(
      {
        host: target.host,
        port: target.port,
        method: request.method,
        path: target.path,
        // The Host header must name the origin, not the proxy: a client that
        // addressed the proxy directly would otherwise send the wrong one on.
        headers: { ...request.headers, host: hostHeader(target) },
        ...(options.upstreamCa ? { ca: options.upstreamCa } : {}),
        // The upstream connection is a normal, verified TLS connection: the
        // proxy reads the traffic, it does not weaken the app's transport.
        rejectUnauthorized: true
      },
      (upstreamResponse) => {
        const responseRedaction = redactHeaders(upstreamResponse.headers as Record<string, string | string[] | undefined>);
        upstreamResponse.on("data", (chunk: Buffer) => (responseBytes += chunk.length));
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
        upstreamResponse.on("end", () =>
          finish({
            status: upstreamResponse.statusCode,
            responseHeaders: responseRedaction.headers,
            mediaType: firstMediaType(upstreamResponse.headers["content-type"]),
            ...(responseRedaction.redacted.length
              ? { redactedHeaders: [...requestRedaction.redacted, ...responseRedaction.redacted] }
              : {})
          })
        );
      }
    );

    upstream.on("error", (error: Error) => {
      // A request that never got a response is evidence too, and losing it
      // would make a broken endpoint look like a request the app never made.
      finish({ error: error.message });
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("atlas-loop proxy: upstream request failed");
    });

    request.pipe(upstream);
  };

  const server = createHttpServer((request, response) => {
    // An absolute-form request URL is what a client sends to a proxy.
    const target = parseAbsoluteTarget(request.url ?? "");
    if (!target) {
      response.writeHead(400, { "content-type": "text/plain" });
      response.end("atlas-loop proxy: expected an absolute request URL");
      return;
    }
    forward(request, response, target);
  });

  // CONNECT is where HTTPS arrives. The tunnel is terminated here with a
  // certificate for the requested host and re-issued upstream.
  server.on("connect", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    receiving = true;
    const [rawHost, rawPort] = (request.url ?? "").split(":");
    const host = rawHost ?? "";
    const port = Number(rawPort ?? 443) || 443;
    if (!host) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    void interceptTls({ host, port, socket, head, mint, ca, forward, record, now, currentActionId }).catch((error: Error) => {
      options.onError?.(error);
      socket.destroy();
    });
  });

  const port = await listen(server, options.port ?? 0);

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    caPath: ca.certPath,
    exchanges: () => [...exchanges],
    receiving: () => receiving,
    truncated: () => truncated,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      })
  };
}

interface InterceptOptions {
  host: string;
  port: number;
  socket: Duplex;
  head: Buffer;
  mint: (host: string) => Promise<string>;
  ca: LocalCertificateAuthority;
  forward: (
    request: IncomingMessage,
    response: ServerResponse,
    target: { scheme: "http" | "https"; host: string; port: number; path: string }
  ) => void;
  record: (exchange: NetworkExchange) => void;
  now: () => Date;
  currentActionId: () => string | undefined;
}

/**
 * Terminates one CONNECT tunnel and reads the requests inside it.
 *
 * If the certificate cannot be minted the tunnel is still recorded, as host,
 * port, and timing — partial evidence, marked as partial, rather than a
 * connection that silently disappears from the capture.
 */
async function interceptTls(options: InterceptOptions): Promise<void> {
  const { host, port, socket, head, mint, ca, forward, record, now, currentActionId } = options;
  const startedAt = now();
  const actionId = currentActionId();

  let cert: string;
  try {
    cert = await mint(host);
  } catch (error) {
    record({
      id: `net_${(exchangeCounter += 1).toString(36)}`,
      startedAt: startedAt.toISOString(),
      method: "CONNECT",
      scheme: "https",
      host,
      port,
      path: "",
      requestBytes: 0,
      responseBytes: 0,
      tunnelled: true,
      error: (error as Error).message,
      ...(actionId ? { actionId } : {})
    });
    socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    return;
  }

  socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

  const tls = createTlsServer({ key: ca.leafKey, cert }, (tlsSocket: TLSSocket) => {
    const inner = createHttpServer((request, response) => {
      forward(request, response, { scheme: "https", host, port, path: request.url ?? "/" });
    });
    inner.emit("connection", tlsSocket);
  });

  tls.on("error", () => socket.destroy());
  tls.emit("connection", socket as Socket);
  if (head.length > 0) socket.unshift(head);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // Loopback only: the capture proxy is not a device other machines can use.
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}

/** `api.example.com` or `api.example.com:8443` — the port is implied when standard. */
export function hostHeader(target: { scheme: "http" | "https"; host: string; port: number }): string {
  const standard = target.scheme === "https" ? 443 : 80;
  return target.port === standard ? target.host : `${target.host}:${target.port}`;
}

/** `http://host:port/path` as a proxied client sends it. */
export function parseAbsoluteTarget(
  url: string
): { scheme: "http" | "https"; host: string; port: number; path: string } | undefined {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    const scheme = parsed.protocol === "https:" ? "https" : "http";
    return {
      scheme,
      host: parsed.hostname,
      port: Number(parsed.port) || (scheme === "https" ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`
    };
  } catch {
    return undefined;
  }
}

/** `application/json; charset=utf-8` is one media type with a parameter. */
export function firstMediaType(value: string | string[] | undefined): string | undefined {
  const flat = Array.isArray(value) ? value[0] : value;
  return flat?.split(";")[0]?.trim() || undefined;
}

/** Installs the local CA into a simulator's trust store. */
export function trustCertificateArgs(udid: string, caPath: string): string[] {
  return ["simctl", "keychain", udid, "add-root-cert", caPath];
}
