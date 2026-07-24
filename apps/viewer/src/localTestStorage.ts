import { compileLocalTestScript, type LocalTestDefinition, type LocalTestRunRecord } from "./localTests.js";

export const LOCAL_TEST_STORAGE_KEY = "atlas-loop.local-tests.v1";
export const LOCAL_TEST_RUN_STORAGE_KEY = "atlas-loop.local-test-runs.v1";

export function loadSavedLocalTests(storage: Storage = window.localStorage): LocalTestDefinition[] {
  try {
    const value = JSON.parse(storage.getItem(LOCAL_TEST_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isLocalTestDefinition).map(cloneTest) : [];
  } catch {
    return [];
  }
}

export function saveLocalTest(test: LocalTestDefinition, storage: Storage = window.localStorage): LocalTestDefinition[] {
  const saved = loadSavedLocalTests(storage);
  const next = [cloneTest(test), ...saved.filter((candidate) => candidate.id !== test.id)].slice(0, 32);
  storage.setItem(LOCAL_TEST_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteLocalTest(id: string, storage: Storage = window.localStorage): LocalTestDefinition[] {
  const next = loadSavedLocalTests(storage).filter((candidate) => candidate.id !== id);
  storage.setItem(LOCAL_TEST_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function loadLocalTestRuns(storage: Storage = window.localStorage): LocalTestRunRecord[] {
  try {
    const value = JSON.parse(storage.getItem(LOCAL_TEST_RUN_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isLocalTestRunRecord).map((record) => ({ ...record })) : [];
  } catch {
    return [];
  }
}

export function saveLocalTestRun(record: LocalTestRunRecord, storage: Storage = window.localStorage): LocalTestRunRecord[] {
  const runs = loadLocalTestRuns(storage);
  const next = [{ ...record }, ...runs.filter((candidate) => candidate.testKey !== record.testKey)].slice(0, 64);
  storage.setItem(LOCAL_TEST_RUN_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function cloneTest(test: LocalTestDefinition): LocalTestDefinition {
  const compiled = compileLocalTestScript(test.script);
  return {
    ...test,
    tags: [...test.tags],
    // The readable script is the source of truth. Recompile on every storage
    // boundary so edited site data cannot smuggle a different action payload
    // behind an innocent-looking test definition.
    steps: compiled.errors.length === 0
      ? compiled.steps
      : test.steps.map((step) => ({ ...step, action: structuredClone(step.action) }))
  };
}

function isLocalTestDefinition(value: unknown): value is LocalTestDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalTestDefinition>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.label === "string" &&
    candidate.label.length > 0 &&
    typeof candidate.detail === "string" &&
    candidate.platform === "ios-simulator" &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === "string") &&
    typeof candidate.script === "string" &&
    Array.isArray(candidate.steps) &&
    candidate.steps.length > 0 &&
    compileLocalTestScript(candidate.script).errors.length === 0
  );
}

function isLocalTestRunRecord(value: unknown): value is LocalTestRunRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalTestRunRecord>;
  return (
    typeof candidate.testKey === "string" &&
    ["passed", "failed", "cancelled"].includes(String(candidate.status)) &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.completedSteps === "number" &&
    typeof candidate.totalSteps === "number" &&
    typeof candidate.message === "string" &&
    typeof candidate.ranAt === "string"
  );
}
