#!/usr/bin/env node
// Exercises a running Atlas Loop driver runner over HTTP and checks the
// response envelope contract. The runner must already be listening (see
// native/ios-driver-runner/README.md for how to start it); this script does
// not spawn xcodebuild itself.
//
// Usage:
//   node scripts/check-driver-runner-protocol.mjs [--url http://127.0.0.1:4700] \
//     [--bundle-id app.atlasloop.CommerceDemo] [--out artifacts/driver-protocol.ndjson] [--shutdown]
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const baseUrl = argValue("--url") ?? "http://127.0.0.1:4700";
const bundleId = argValue("--bundle-id");
const outPath = argValue("--out");
const shutdownAfter = process.argv.includes("--shutdown");

const transcript = [];

async function call(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  transcript.push({ request: { method, path, body: body ?? null }, status: response.status, response: payload });
  return { status: response.status, payload };
}

function expectEnvelope(step, payload, { ok, errorCode, id } = {}) {
  if (typeof payload.ok !== "boolean") throw new Error(`${step}: envelope is missing boolean ok: ${JSON.stringify(payload)}`);
  if (ok !== undefined && payload.ok !== ok) throw new Error(`${step}: expected ok=${ok}, got ${JSON.stringify(payload)}`);
  if (id !== undefined && payload.id !== id) throw new Error(`${step}: expected id=${id}, got ${JSON.stringify(payload)}`);
  if (!payload.ok) {
    const error = payload.error;
    if (!error || typeof error.code !== "string" || typeof error.message !== "string" || typeof error.retryable !== "boolean") {
      throw new Error(`${step}: failure envelope must carry error {code, message, retryable}: ${JSON.stringify(payload)}`);
    }
    if (errorCode && error.code !== errorCode) {
      throw new Error(`${step}: expected error code ${errorCode}, got ${error.code}`);
    }
  }
}

const health = await call("GET", "/health");
if (health.status !== 200 || health.payload.ok !== true || typeof health.payload.runnerVersion !== "string") {
  throw new Error(`health check failed: ${JSON.stringify(health.payload)}`);
}
console.log(`[driver-protocol] runner ${health.payload.runnerVersion} healthy at ${baseUrl}`);

const invalidBody = await call("POST", "/command", { id: "chk-invalid", x: 0.5 });
expectEnvelope("missing kind", invalidBody.payload, { ok: false, errorCode: "invalidRequest", id: "chk-invalid" });

const unknownKind = await call("POST", "/command", { id: "chk-unknown", kind: "hover" });
expectEnvelope("unknown kind", unknownKind.payload, { ok: false, errorCode: "unknownCommand", id: "chk-unknown" });

const badTarget = await call("POST", "/target", { id: "chk-target-bad" });
expectEnvelope("target without bundleId", badTarget.payload, { ok: false, errorCode: "invalidRequest" });

if (!bundleId) {
  const noTarget = await call("POST", "/command", { id: "chk-no-target", kind: "tap", x: 0.5, y: 0.5 });
  expectEnvelope("tap without target", noTarget.payload, { ok: false, errorCode: "noTargetApp", id: "chk-no-target" });
} else {
  const target = await call("POST", "/target", { id: "chk-target", bundleId });
  expectEnvelope("target", target.payload, { ok: true });

  const badCoordinates = await call("POST", "/command", { id: "chk-coords", kind: "tap", x: 1.5, y: 0.5 });
  expectEnvelope("invalid coordinates", badCoordinates.payload, { ok: false, errorCode: "invalidCoordinates", id: "chk-coords" });

  const tap = await call("POST", "/command", { id: "chk-tap", kind: "tap", x: 0.5, y: 0.5 });
  expectEnvelope("tap", tap.payload, { ok: true, id: "chk-tap" });

  const missingElement = await call("POST", "/command", {
    id: "chk-missing-element",
    kind: "assertVisible",
    identifier: "atlas-loop-no-such-element",
    timeoutMs: 500
  });
  expectEnvelope("assertVisible missing element", missingElement.payload, { ok: false, errorCode: "elementNotFound", id: "chk-missing-element" });
}

if (shutdownAfter) {
  const shutdown = await call("POST", "/shutdown");
  if (shutdown.payload.ok !== true) throw new Error(`shutdown failed: ${JSON.stringify(shutdown.payload)}`);
}

if (outPath) {
  const resolvedOut = resolve(outPath);
  await mkdir(dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, transcript.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  console.log(`[driver-protocol] transcript written to ${resolvedOut}`);
}

console.log(`[driver-protocol] ok (${transcript.length} calls${bundleId ? `, targeted ${bundleId}` : ", no bundle id"})`);
