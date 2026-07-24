import { compileLocalTestScript } from "./localTests.js";
import type { LocalTestModule } from "./localTestModules.js";

export const LOCAL_TEST_MODULE_STORAGE_KEY = "atlas-loop.local-test-modules.v1";
const MAX_SAVED_MODULES = 32;

export function loadSavedLocalTestModules(storage: Storage = window.localStorage): LocalTestModule[] {
  try {
    const value = JSON.parse(storage.getItem(LOCAL_TEST_MODULE_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isLocalTestModule).map(cloneModule) : [];
  } catch {
    return [];
  }
}

export function saveLocalTestModule(module: LocalTestModule, storage: Storage = window.localStorage): LocalTestModule[] {
  const compiled = compileLocalTestScript(module.script);
  if (compiled.errors.length > 0 || compiled.steps.length === 0) throw new Error("Module script must compile before it can be saved.");
  const saved = loadSavedLocalTestModules(storage);
  const next = [cloneModule({ ...module, steps: compiled.steps }), ...saved.filter((candidate) => candidate.id !== module.id)].slice(0, MAX_SAVED_MODULES);
  storage.setItem(LOCAL_TEST_MODULE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteLocalTestModule(id: string, storage: Storage = window.localStorage): LocalTestModule[] {
  const next = loadSavedLocalTestModules(storage).filter((candidate) => candidate.id !== id);
  storage.setItem(LOCAL_TEST_MODULE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function cloneModule(module: LocalTestModule): LocalTestModule {
  const compiled = compileLocalTestScript(module.script);
  return {
    ...module,
    tags: [...module.tags],
    // Readable source remains authoritative at every storage boundary. Stored
    // action payloads are never trusted independently of the visible script.
    steps: compiled.errors.length === 0 ? compiled.steps : []
  };
}

function isLocalTestModule(value: unknown): value is LocalTestModule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalTestModule>;
  if (
    typeof candidate.id !== "string" || !candidate.id.trim() ||
    typeof candidate.label !== "string" || !candidate.label.trim() ||
    typeof candidate.detail !== "string" ||
    !Array.isArray(candidate.tags) || !candidate.tags.every((tag) => typeof tag === "string") ||
    typeof candidate.script !== "string" ||
    !Array.isArray(candidate.steps)
  ) return false;
  const compiled = compileLocalTestScript(candidate.script);
  return compiled.errors.length === 0 && compiled.steps.length > 0;
}
