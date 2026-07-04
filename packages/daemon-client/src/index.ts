import type {
  ActionInput,
  ActionResult,
  ApiEnvelope,
  ArtifactType,
  ArtifactRef,
  AtlasLoopError,
  BuildRequest,
  CreateSessionRequest,
  InstallRequest,
  LaunchRequest,
  PerformActionRequest,
  Session,
  TraceEvent
} from "@atlas-loop/protocol";

export interface SessionSummary {
  session: Session;
  paths: {
    artifactDir: string;
    manifest: string;
    trace: string;
    screenshots: string;
  };
  artifacts: {
    total: number;
    byType: Partial<Record<ArtifactType, number>>;
    latestScreenshot?: ArtifactRef;
  };
  events: {
    total: number;
    latestAction?: Pick<ActionResult, "actionId" | "ok" | "startedAt" | "endedAt" | "error"> & {
      artifactCount: number;
    };
    latestError?: AtlasLoopError;
  };
  storage: {
    source: "memory" | "disk";
    artifactBacked: boolean;
    warnings: Array<{ path: string; message: string }>;
  };
}

export interface DaemonClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  apiPrefix?: string;
}

export class DaemonClientError extends Error implements AtlasLoopError {
  code: AtlasLoopError["code"];
  retryable?: boolean;
  details?: Record<string, unknown>;

  constructor(error: AtlasLoopError) {
    super(error.message);
    this.name = "DaemonClientError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

export class DaemonClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiPrefix: string;

  constructor(options: DaemonClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? process.env.ATLAS_LOOP_DAEMON_URL ?? "http://127.0.0.1:4317");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiPrefix = options.apiPrefix ?? "";
  }

  health(): Promise<{ status: string; sessions: number; uptimeSeconds: number }> {
    return this.request("GET", "/health");
  }

  listSessions(): Promise<Session[]> {
    return this.request("GET", "/sessions");
  }

  createSession(request: CreateSessionRequest = {}): Promise<Session> {
    return this.request("POST", "/sessions", request);
  }

  getSession(sessionId: string): Promise<Session> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}`);
  }

  getSessionSummary(sessionId: string): Promise<SessionSummary> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/summary`);
  }

  endSession(sessionId: string): Promise<Session> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/end`);
  }

  build(sessionId: string, request: BuildRequest): Promise<unknown> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/build`, request);
  }

  install(sessionId: string, request: InstallRequest): Promise<unknown> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/install`, request);
  }

  launch(sessionId: string, request: LaunchRequest): Promise<unknown> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/launch`, request);
  }

  performAction(sessionId: string, request: PerformActionRequest | ActionInput): Promise<ActionResult> {
    const body = "action" in request ? request : { action: request };
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/actions`, body);
  }

  screenshot(sessionId: string, reason?: string): Promise<ActionResult> {
    return this.request("POST", `/sessions/${encodeURIComponent(sessionId)}/screenshot`, reason ? { reason } : {});
  }

  latestScreenshot(sessionId: string): Promise<ArtifactRef> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/artifacts/latest-screenshot`);
  }

  listArtifacts(sessionId: string): Promise<ArtifactRef[]> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/artifacts`);
  }

  events(sessionId: string): Promise<TraceEvent[]> {
    return this.request("GET", `/sessions/${encodeURIComponent(sessionId)}/events`);
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${this.apiPrefix}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const envelope = parseEnvelope<T>(text);
    if (!response.ok || envelope.ok === false) {
      throw new DaemonClientError(envelope.error ?? {
        code: response.status === 404 ? "NOT_FOUND" : "COMMAND_FAILED",
        message: response.statusText || `HTTP ${response.status}`,
        details: { status: response.status, body: text }
      });
    }
    if (!envelope.ok) {
      throw new DaemonClientError({
        code: "COMMAND_FAILED",
        message: "daemon returned a malformed response",
        details: { status: response.status, body: text }
      });
    }
    return envelope.data as T;
  }
}

function parseEnvelope<T>(text: string): ApiEnvelope<T> {
  if (!text) return { ok: true } as ApiEnvelope<T>;
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    return {
      ok: false,
      error: {
        code: "COMMAND_FAILED",
        message: "daemon returned non-JSON response",
        details: { body: text }
      }
    };
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
