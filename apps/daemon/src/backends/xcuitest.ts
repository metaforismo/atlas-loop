import { atlasError, type ActionInput, type Session } from "@atlas-loop/protocol";
import type { InputActionKind, InputBackend } from "./types.ts";

/** The manager surface the daemon needs; matches XcuitestRunnerManager. */
export interface XcuitestManagerLike {
  ensureRunner(udid: string): Promise<{ udid: string; port: number; alive: boolean; restarts: number; xctestrunPath: string }>;
  setTarget(udid: string, bundleId: string): Promise<Record<string, unknown> | undefined>;
  performAction(udid: string, action: ActionInput): Promise<Record<string, unknown> | undefined>;
  close(): Promise<void>;
}

export interface XcuitestBackendOptions {
  manager: XcuitestManagerLike;
  /** Shared per-UDID record of the bundle id most recently targeted on the runner. */
  targets: Map<string, string>;
  resolveUdid: (session: Session) => Promise<string>;
}

const XCUITEST_KINDS: ReadonlySet<InputActionKind> = new Set([
  "tap",
  "typeText",
  "swipe",
  "edgeGesture",
  "tapElement",
  "assertVisible"
]);

export function createXcuitestBackend(options: XcuitestBackendOptions): InputBackend {
  return {
    name: "xcuitest",
    supports: (kind) => XCUITEST_KINDS.has(kind),
    describe: (session) => ({
      driver: "xcuitest-runner",
      simulatorUdid: session.simulator.udid ?? null,
      targetBundleId: session.app?.bundleId ?? null
    }),
    async performAction(session, action) {
      const bundleId = session.app?.bundleId;
      if (!bundleId) {
        throw atlasError(
          "INVALID_REQUEST",
          "the xcuitest input backend drives a launched app; run launch --bundle-id <id> before input actions"
        );
      }

      const udid = await options.resolveUdid(session);
      const drive = async (): Promise<Record<string, unknown>> => {
        const status = await options.manager.ensureRunner(udid);
        // The target must be re-sent whenever a fresh runner process starts,
        // so the recorded key is tied to the runner generation, not just udid.
        const targetKey = `${bundleId}#${status.restarts}#${status.port}`;
        if (options.targets.get(udid) !== targetKey) {
          await options.manager.setTarget(udid, bundleId);
          options.targets.set(udid, targetKey);
        }

        const driverData = await options.manager.performAction(udid, actionInputForDriver(action));
        return {
          runnerPort: status.port,
          runnerRestarts: status.restarts,
          simulatorUdid: udid,
          ...(driverData ? { driverData } : {})
        };
      };

      try {
        return await drive();
      } catch (error) {
        if (!isRetryableDriverError(error)) throw error;
        // One self-heal attempt: ensureRunner restarts a dead runner and the
        // generation-aware target key re-targets the app on the new process.
        return await drive();
      }
    },
    // The manager outlives individual actions; the daemon closes it on shutdown.
    close: async () => undefined
  };
}

function isRetryableDriverError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "DRIVER_UNAVAILABLE" &&
    (error as { retryable?: unknown }).retryable === true
  );
}

function actionInputForDriver(action: ActionInput & { id?: string; sessionId?: string; createdAt?: string; sequence?: number }): ActionInput {
  const { id, sessionId, createdAt, sequence, ...input } = action;
  void id;
  void sessionId;
  void createdAt;
  void sequence;
  return input as ActionInput;
}
