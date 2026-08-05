import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { CSRF_HEADER_NAME } from '../../src/auth/csrf.util';

// Every user this suite creates is tagged with this domain, distinct
// from Playwright's own `@e2e.agenttrace.test` convention, so a person
// inspecting the dev database can tell the two suites' leftover data
// apart. global-teardown.ts sweeps rows by this exact tag; nothing
// outside it is ever touched.
export const TEST_EMAIL_DOMAIN = '@api-integration.agenttrace.test';

export function uniqueEmail(): string {
  return `user-${randomUUID()}${TEST_EMAIL_DOMAIN}`;
}

export type TestAgent = ReturnType<typeof request.agent>;

// supertest's Response.body is typed `any` (it has no way to know the
// real shape of whatever the server returned). Every response this
// suite reads is cast through this one helper immediately after the
// request, matching this project's existing pattern elsewhere
// (installations.service.spec.ts casts `.mock.calls` the same way)
// rather than accessing `.body` directly at each call site, which trips
// @typescript-eslint/no-unsafe-member-access repeatedly for no real
// safety benefit here: the actual runtime shape is exactly what each
// test's own status-code assertion already confirms.
export function body<T>(res: request.Response): T {
  return res.body as T;
}

export interface UserResponseBody {
  userId: string;
  email?: string;
  name?: string;
  orgId?: string;
  role?: string;
}

export interface ErrorResponseBody {
  message: string;
}

export interface ProjectResponseBody {
  id: string;
  name: string;
}

export interface ApiKeyResponseBody {
  id: string;
  key: string;
}

export interface TraceResponseBody {
  id: string;
  status: string;
}

export interface SpanResponseBody {
  id: string;
  traceId: string;
}

export interface SignedUpAgent {
  agent: TestAgent;
  email: string;
  password: string;
  orgName: string;
}

// Signs up a brand-new, uniquely-tagged user and returns a supertest
// *agent* (not a one-off `request(app)` call) carrying the resulting
// session cookie -- almost every other test starts from this. An agent
// persists cookies across calls the same way a real browser would; a
// fresh `request(app)` per call would never see a Set-Cookie header
// apply to anything.
export async function signupAndGetAgent(
  app: INestApplication,
): Promise<SignedUpAgent> {
  const email = uniqueEmail();
  const password = 'correct-horse-battery-staple';
  const orgName = `Test Org ${randomUUID()}`;
  const agent = request.agent(app.getHttpServer() as Server);

  const res = await agent.post('/auth/signup').send({
    email,
    password,
    name: 'Test User',
    orgName,
  });
  if (res.status !== 201) {
    throw new Error(
      `signupAndGetAgent: signup failed with ${res.status}: ${JSON.stringify(res.body)}`,
    );
  }

  return { agent, email, password, orgName };
}

// Does the real GET /auth/csrf round trip a browser does (matching
// apps/web/src/lib/api.ts's own ensureCsrfToken()): read the
// agenttrace_csrf cookie back off the response, return it as the
// header a mutating call needs to echo. Deliberately never imports
// computeCsrfToken() directly -- that's an implementation detail, and
// coupling this suite to it would let a test pass even if the actual,
// public cookie-issuance/header-echo contract broke.
export async function getCsrfHeader(
  agent: TestAgent,
): Promise<Record<string, string>> {
  const res = await agent.get('/auth/csrf');
  const setCookie = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  const csrfCookie = cookies.find((c) => c.startsWith('agenttrace_csrf='));
  if (!csrfCookie) {
    throw new Error('getCsrfHeader: no agenttrace_csrf cookie in response');
  }
  const value = csrfCookie.split(';')[0].split('=')[1];
  return { [CSRF_HEADER_NAME]: value };
}
