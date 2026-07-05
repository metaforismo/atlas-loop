import type { HidClient, HidClientOptions } from "@atlas-loop/hid-client";
import { atlasError, type Action, type Session } from "@atlas-loop/protocol";
import type { InputAction, InputActionKind, InputBackend } from "./types.ts";

const CGEVENT_KINDS: ReadonlySet<InputActionKind> = new Set(["tap", "typeText", "swipe", "edgeGesture"]);

type CgEventAction = Extract<Action, { kind: "tap" | "typeText" | "swipe" | "edgeGesture" }>;

export interface CgEventBackendOptions {
  helperPath: string;
  hidClientFactory: (options: HidClientOptions) => HidClient;
}

export function simulatorTarget(session: Session): string {
  return session.simulator.udid ?? session.simulator.name ?? "booted";
}

export function simulatorAttachOptions(session: Session): { appName: string; windowTitleContains?: string } {
  return {
    appName: "Simulator",
    ...(session.simulator.name ? { windowTitleContains: session.simulator.name } : {})
  };
}

function isCgEventAction(action: InputAction): action is CgEventAction {
  return CGEVENT_KINDS.has(action.kind);
}

export function createCgEventBackend(options: CgEventBackendOptions): InputBackend {
  return {
    name: "cgevent",
    supports: (kind) => CGEVENT_KINDS.has(kind),
    describe: (session) => ({
      helperPath: options.helperPath,
      helperTarget: simulatorTarget(session),
      attachOptions: simulatorAttachOptions(session)
    }),
    async performAction(session, action) {
      if (!isCgEventAction(action)) {
        throw atlasError(
          "INVALID_REQUEST",
          `the cgevent input backend does not support ${action.kind}; start the session with --input-backend xcuitest`
        );
      }

      const hid = options.hidClientFactory({ helperPath: options.helperPath });
      try {
        await hid.attach(simulatorAttachOptions(session));
        await hid.performAction(simulatorTarget(session), action);
        return undefined;
      } finally {
        hid.close();
      }
    },
    close: async () => undefined
  };
}
