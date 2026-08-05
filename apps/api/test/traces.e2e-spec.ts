import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'http';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupTaggedTestData } from './support/cleanup';
import { createTestApp } from './support/test-app';
import {
  body,
  getCsrfHeader,
  signupAndGetAgent,
  type ApiKeyResponseBody,
  type ProjectResponseBody,
  type SpanResponseBody,
  type TraceResponseBody,
} from './support/test-data';

// One real API key, created through the real HTTP flow, shared by
// every test below: the point of this file is proving the full chain
// (key auth -> ingestion -> upsert) works together for real, not
// re-testing key creation itself (api-keys.e2e-spec.ts already does).
async function createProjectAndApiKey(
  app: INestApplication,
): Promise<{ apiKey: string; projectId: string }> {
  const { agent } = await signupAndGetAgent(app);
  const csrfHeader = await getCsrfHeader(agent);
  const project = await agent
    .post('/projects')
    .set(csrfHeader)
    .send({ name: 'Trace Ingestion Project' });
  const projectBody = body<ProjectResponseBody>(project);
  const key = await agent
    .post(`/projects/${projectBody.id}/api-keys`)
    .set(csrfHeader)
    .send({ name: 'ingestion key' });
  return {
    apiKey: body<ApiKeyResponseBody>(key).key,
    projectId: projectBody.id,
  };
}

describe('Trace and span ingestion (e2e)', () => {
  let app: INestApplication;
  let apiKey: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ apiKey } = await createProjectAndApiKey(app));
  });

  afterAll(async () => {
    await cleanupTaggedTestData(app.get(PrismaService));
    await app.close();
  });

  it('creates a trace via a real API key', async () => {
    const res = await request(app.getHttpServer() as Server)
      .post('/traces')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalTraceId: randomUUID(),
        name: 'integration-test-run',
        agentName: 'integration-test-agent',
        startedAt: new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(body<TraceResponseBody>(res).status).toBe('RUNNING');
    expect(res.body).toHaveProperty('id');
  });

  it('updates the same trace on a second call with the same externalTraceId', async () => {
    const externalTraceId = randomUUID();
    const server = app.getHttpServer() as Server;

    const first = await request(server)
      .post('/traces')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalTraceId,
        name: 'upsert-test-run',
        agentName: 'integration-test-agent',
        startedAt: new Date().toISOString(),
      });

    const second = await request(server)
      .post('/traces')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        externalTraceId,
        name: 'upsert-test-run',
        agentName: 'integration-test-agent',
        status: 'SUCCESS',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });

    expect(second.status).toBe(201);
    // Same underlying row updated, not a second one created: the whole
    // point of externalTraceId-keyed upsert (ADR-0008).
    const firstTrace = body<TraceResponseBody>(first);
    const secondTrace = body<TraceResponseBody>(second);
    expect(secondTrace.id).toBe(firstTrace.id);
    expect(secondTrace.status).toBe('SUCCESS');
  });

  it('adds a span to an existing trace', async () => {
    const trace = await request(app.getHttpServer() as Server)
      .post('/traces')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        name: 'trace-with-a-span',
        agentName: 'integration-test-agent',
        startedAt: new Date().toISOString(),
      });
    const traceBody = body<TraceResponseBody>(trace);

    const span = await request(app.getHttpServer() as Server)
      .post(`/traces/${traceBody.id}/spans`)
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        name: 'call-llm',
        type: 'LLM',
        startedAt: new Date().toISOString(),
      });

    expect(span.status).toBe(201);
    expect(body<SpanResponseBody>(span).traceId).toBe(traceBody.id);
  });

  it("rejects ingestion into a trace belonging to a different project's key", async () => {
    const { apiKey: otherApiKey } = await createProjectAndApiKey(app);
    const trace = await request(app.getHttpServer() as Server)
      .post('/traces')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        name: 'owner-project-trace',
        agentName: 'integration-test-agent',
        startedAt: new Date().toISOString(),
      });
    const traceId = body<TraceResponseBody>(trace).id;

    const crossProjectSpan = await request(app.getHttpServer() as Server)
      .post(`/traces/${traceId}/spans`)
      .set('Authorization', `Bearer ${otherApiKey}`)
      .send({
        name: 'should-not-be-allowed',
        type: 'LLM',
        startedAt: new Date().toISOString(),
      });

    expect(crossProjectSpan.status).toBe(404);
  });
});
