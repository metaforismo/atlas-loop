#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const helperPath = process.argv[2] ?? "native/ios-hid-helper/.build/debug/ios-hid-helper";
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

const requests = [
  { id: "hello", type: "hello", data: {} },
  { id: "metrics", type: "metrics", data: {} },
  { id: "shutdown", type: "shutdown", data: {} }
];

const child = spawn(resolve(helperPath), [], { stdio: ["pipe", "pipe", "pipe"] });
let stdout = "";
let stderr = "";

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
child.stdin.end();

const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
if (outPath) {
  const resolvedOut = resolve(outPath);
  await mkdir(dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, stdout, "utf8");
}

if (exitCode !== 0) {
  throw new Error(`helper exited with ${exitCode}: ${stderr.trim()}`);
}

const responses = stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const byId = new Map(responses.map((response) => [response.id, response]));

expectOk(byId.get("hello"), "hello");
expectOk(byId.get("metrics"), "metrics");
expectOk(byId.get("shutdown"), "shutdown");

const hello = byId.get("hello");
const commands = hello?.data?.commands;
for (const command of ["hello", "metrics", "shutdown", "tap", "typeText", "swipe", "edgeGesture"]) {
  if (!Array.isArray(commands) || !commands.includes(command)) {
    throw new Error(`hello response did not advertise ${command}`);
  }
}

const metrics = byId.get("metrics");
if (typeof metrics?.data?.backend !== "string") throw new Error("metrics response did not include backend");
if (typeof metrics?.data?.privateBackendAvailable !== "boolean") {
  throw new Error("metrics response did not include privateBackendAvailable");
}
if (!metrics?.data?.diagnostics || typeof metrics.data.diagnostics !== "object") {
  throw new Error("metrics response did not include diagnostics");
}

console.log(JSON.stringify({
  ok: true,
  helperPath: resolve(helperPath),
  responseCount: responses.length,
  outPath: outPath ? resolve(outPath) : undefined
}, null, 2));

function expectOk(response, type) {
  if (!response) throw new Error(`missing ${type} response`);
  if (response.type !== type) throw new Error(`expected ${type} response, received ${response.type}`);
  if (response.ok !== true) throw new Error(`${type} response failed: ${JSON.stringify(response.error)}`);
}
