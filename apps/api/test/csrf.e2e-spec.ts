import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupTaggedTestData } from './support/cleanup';
import { createTestApp } from './support/test-app';
import {
  body,
  getCsrfHeader,
  signupAndGetAgent,
  type ApiKeyResponseBody,
  type ProjectResponseBody,
} from './support/test-data';

// Project creation is used here purely as a stand-in mutating route --
// this file's own subject is the CSRF contract itself, not project
// creation (projects.e2e-spec.ts already covers that). Every token used
// below comes from the real GET /auth/csrf response, never from
// computeCsrfToken() directly: that function is an implementation
// detail, and importing it here would let these tests pass even if the
// actual cookie-issuance/header-echo contract broke.
describe('CSRF (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTaggedTestData(app.get(PrismaService));
    await app.close();
  });

  it('allows a mutating request with the real token obtained from GET /auth/csrf', async () => {
    const { agent } = await signupAndGetAgent(app);
    const csrfHeader = await getCsrfHeader(agent);

    const res = await agent
      .post('/projects')
      .set(csrfHeader)
      .send({ name: 'CSRF-protected project' });

    expect(res.status).toBe(201);
  });

  it('rejects a mutating request with no CSRF header at all', async () => {
    const { agent } = await signupAndGetAgent(app);

    const res = await agent.post('/projects').send({ name: 'No CSRF header' });

    expect(res.status).toBe(403);
  });

  it('rejects a mutating request with a token from a different session', async () => {
    const { agent } = await signupAndGetAgent(app);
    const otherSession = await signupAndGetAgent(app);
    const otherSessionCsrfHeader = await getCsrfHeader(otherSession.agent);

    const res = await agent
      .post('/projects')
      .set(otherSessionCsrfHeader)
      .send({ name: 'Wrong session token' });

    expect(res.status).toBe(403);
  });

  it('never enforces CSRF on safe methods (GET)', async () => {
    const { agent } = await signupAndGetAgent(app);

    // No X-CSRF-Token header at all, on purpose: GET is a safe method,
    // CsrfGuard exempts it unconditionally.
    const res = await agent.get('/projects');

    expect(res.status).toBe(200);
  });

  it('never enforces CSRF on API-key-authenticated requests', async () => {
    // A request authenticated via Authorization header, never via a
    // session cookie, has nothing for CSRF to exploit -- a cross-site
    // page can't attach a header it was never given. Confirmed here
    // with a real request carrying an Authorization header and
    // deliberately no X-CSRF-Token at all.
    const { agent } = await signupAndGetAgent(app);
    const csrfHeader = await getCsrfHeader(agent);
    const project = await agent
      .post('/projects')
      .set(csrfHeader)
      .send({ name: 'For an API key' });
    const projectId = body<ProjectResponseBody>(project).id;
    const key = await agent
      .post(`/projects/${projectId}/api-keys`)
      .set(csrfHeader)
      .send({ name: 'no csrf needed' });
    const rawKey = body<ApiKeyResponseBody>(key).key;

    // Deliberately no X-CSRF-Token header on this request at all: an
    // API-key-authenticated mutation succeeding without one is exactly
    // what proves CsrfGuard skips enforcement for this auth mechanism.
    const ingest = await agent
      .post('/traces')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({
        name: 'api-key-authenticated, no csrf',
        agentName: 'integration-test-agent',
        startedAt: new Date().toISOString(),
      });

    expect(ingest.status).toBe(201);
  });
});
