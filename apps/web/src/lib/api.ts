import type {
  ApiKeyRecord,
  CliAuthorizePayload,
  CliAuthorizeResponse,
  CreateApiKeyPayload,
  CreateApiKeyResponse,
  CreateProjectPayload,
  CurrentUser,
  EvalResultRecord,
  InstallationRecord,
  ListTracesQuery,
  ListTracesResponse,
  LoginPayload,
  ProjectRecord,
  SignupPayload,
  TraceDetailResponse,
} from "@agenttrace/shared-types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// A 401 means the session is missing, expired, or otherwise invalid,
// something proxy.ts's cookie-presence check cannot know in advance (see
// proxy.ts). This is the real authentication check; every caller of this
// client gets it automatically, for free, rather than having to remember
// to handle 401 itself. A full page navigation is used on purpose, not
// client-side routing, an expired session means any in-memory app state
// is stale anyway.
//
// Logout is called first to clear the stale cookie before navigating.
// Without this, the browser still holds a cookie the server no longer
// considers valid; proxy.ts's convenience check only looks at presence,
// so it would immediately redirect /login back to /projects, which
// 401s again, looping forever. This was caught by manual testing, not
// something apparent from reading either file in isolation.
async function redirectToLogin(): Promise<void> {
  if (typeof window === "undefined") return;
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
  window.location.href = "/login";
}

const CSRF_COOKIE_NAME = "agenttrace_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// login/signup/logout are the only mutating routes that don't require
// an existing session (they create or destroy one), so there's no CSRF
// token to attach yet and no point bootstrapping one first -- this is
// the frontend's equivalent of CsrfGuard's own request.user-based
// exemption on the backend. See ADR-0014.
const CSRF_EXEMPT_PATHS = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/logout",
]);

// Not httpOnly on the server side specifically so this can read it. See
// csrf.util.ts and ADR-0014 for why the cookie's value, not some
// separately-stored token, is what gets echoed back as a header.
function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null; // server-rendered, no cookie jar to read
  const prefix = `${CSRF_COOKIE_NAME}=`;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

// A singleton promise, not a fire-and-forget call after me() succeeds:
// this makes the guarantee "a mutation never runs before a CSRF token
// exists" hold regardless of component call order, rather than relying
// on a specific sequence (me() succeeding, then some effect firing,
// then the user happening to wait long enough before clicking
// anything). Whichever mutating call happens first -- a proactive
// warmup, or literally the first "create project" click -- triggers
// and awaits this; every later mutating call awaits the same
// already-resolved promise, effectively free. See ADR-0014.
let csrfReadyPromise: Promise<void> | null = null;

function ensureCsrfToken(): Promise<void> {
  if (readCsrfCookie()) return Promise.resolve();
  if (!csrfReadyPromise) {
    csrfReadyPromise = request<void>("/auth/csrf").catch((error: unknown) => {
      csrfReadyPromise = null; // let a later mutating call retry the bootstrap
      throw error;
    });
  }
  return csrfReadyPromise;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (MUTATING_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(path)) {
    await ensureCsrfToken();
    const csrfToken = readCsrfCookie();
    // If still missing after the bootstrap attempt (shouldn't happen,
    // but not this client's job to guess why), proceed without the
    // header and let the server's own 403 be the definitive signal,
    // rather than throwing client-side on a guess.
    if (csrfToken) headers[CSRF_HEADER_NAME] = csrfToken;
  }

  const response = await fetch(`/api${path}`, {
    ...init,
    method,
    credentials: "include",
    headers,
  });

  if (response.status === 401) {
    await redirectToLogin();
    throw new ApiError(401, "Not signed in");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
    };
    const message = Array.isArray(body.message)
      ? body.message.join(", ")
      : body.message;
    throw new ApiError(
      response.status,
      message ?? `Request failed with status ${response.status}`,
    );
  }

  // GET /auth/csrf (the bootstrap endpoint) returns 204 with no body.
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export function signup(payload: SignupPayload): Promise<{ userId: string }> {
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: LoginPayload): Promise<{ userId: string }> {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logout(): Promise<{ success: boolean }> {
  return request("/auth/logout", { method: "POST" });
}

export function me(): Promise<CurrentUser> {
  return request("/auth/me");
}

export function listProjects(): Promise<ProjectRecord[]> {
  return request("/projects");
}

export function createProject(
  payload: CreateProjectPayload,
): Promise<ProjectRecord> {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listTraces(
  projectId: string,
  query: ListTracesQuery,
): Promise<ListTracesResponse> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.agentName) params.set("agentName", query.agentName);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));

  const queryString = params.toString();
  return request(
    `/projects/${projectId}/traces${queryString ? `?${queryString}` : ""}`,
  );
}

export function getTraceDetail(
  projectId: string,
  traceId: string,
): Promise<TraceDetailResponse> {
  return request(`/projects/${projectId}/traces/${traceId}`);
}

export function listApiKeys(projectId: string): Promise<ApiKeyRecord[]> {
  return request(`/projects/${projectId}/api-keys`);
}

export function createApiKey(
  projectId: string,
  payload: CreateApiKeyPayload,
): Promise<CreateApiKeyResponse> {
  return request(`/projects/${projectId}/api-keys`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeApiKey(
  projectId: string,
  keyId: string,
): Promise<{ success: boolean }> {
  return request(`/projects/${projectId}/api-keys/${keyId}`, {
    method: "DELETE",
  });
}

export function listEvaluations(
  projectId: string,
  traceId: string,
): Promise<EvalResultRecord[]> {
  return request(`/projects/${projectId}/traces/${traceId}/evaluations`);
}

export function triggerEvaluation(
  projectId: string,
  traceId: string,
): Promise<EvalResultRecord> {
  return request(`/projects/${projectId}/traces/${traceId}/evaluate`, {
    method: "POST",
  });
}

export function listInstallations(
  projectId: string,
): Promise<InstallationRecord[]> {
  return request(`/projects/${projectId}/installations`);
}

export function revokeInstallation(
  projectId: string,
  installationId: string,
): Promise<{ success: boolean }> {
  return request(`/projects/${projectId}/installations/${installationId}`, {
    method: "DELETE",
  });
}

// The CLI itself (a future milestone) exchanges the resulting code for
// a real credential by calling POST /cli/token directly against the
// API, not through this web app -- there is deliberately no
// cliTokenExchange wrapper here.
export function cliAuthorize(
  payload: CliAuthorizePayload,
): Promise<CliAuthorizeResponse> {
  return request("/cli/authorize", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
