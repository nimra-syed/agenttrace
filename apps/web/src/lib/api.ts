import type {
  CreateProjectPayload,
  CurrentUser,
  ListTracesQuery,
  ListTracesResponse,
  LoginPayload,
  ProjectRecord,
  SignupPayload,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
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
