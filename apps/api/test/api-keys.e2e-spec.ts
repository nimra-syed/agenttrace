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
  type ErrorResponseBody,
  type ProjectResponseBody,
} from './support/test-data';

async function createProject(
  agent: Awaited<ReturnType<typeof signupAndGetAgent>>['agent'],
  name: string,
): Promise<ProjectResponseBody> {
  const csrfHeader = await getCsrfHeader(agent);
  const res = await agent.post('/projects').set(csrfHeader).send({ name });
  return body<ProjectResponseBody>(res);
}

describe('API keys (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTaggedTestData(app.get(PrismaService));
    await app.close();
  });

  it('creates a key, returning the raw value exactly once', async () => {
    const { agent } = await signupAndGetAgent(app);
    const project = await createProject(agent, 'Key Test Project');
    const csrfHeader = await getCsrfHeader(agent);

    const created = await agent
      .post(`/projects/${project.id}/api-keys`)
      .set(csrfHeader)
      .send({ name: 'CI key' });

    const createdKey = body<ApiKeyResponseBody>(created);
    expect(created.status).toBe(201);
    expect(typeof createdKey.key).toBe('string');
    expect(createdKey.key.length).toBeGreaterThan(10);

    const list = await agent.get(`/projects/${project.id}/api-keys`);
    expect(list.status).toBe(200);
    const [firstListed] = body<ApiKeyResponseBody[]>(list);
    expect(firstListed).not.toHaveProperty('key');
    expect(firstListed).not.toHaveProperty('keyHash');
  });

  it('revokes a key, and a revoked key can no longer authenticate ingestion', async () => {
    const { agent } = await signupAndGetAgent(app);
    const project = await createProject(agent, 'Revoke Test Project');
    const csrfHeader = await getCsrfHeader(agent);

    const created = await agent
      .post(`/projects/${project.id}/api-keys`)
      .set(csrfHeader)
      .send({ name: 'to be revoked' });
    const createdKey = body<ApiKeyResponseBody>(created);
    const rawKey = createdKey.key;
    const keyId = createdKey.id;

    const revoked = await agent
      .delete(`/projects/${project.id}/api-keys/${keyId}`)
      .set(csrfHeader);
    expect(revoked.status).toBe(200);

    const ingestAttempt = await request(app.getHttpServer() as Server)
      .post('/traces')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({
        name: 'should not be accepted',
        agentName: 'test-agent',
        startedAt: new Date().toISOString(),
      });

    expect(ingestAttempt.status).toBe(401);
  });

  // ApiKeyGuard's own documented rule: every failure mode returns the
  // exact same generic message, so a caller can never distinguish "no
  // such key" from "revoked key" from "malformed header" from the
  // response alone. Proven here with four real HTTP requests, not the
  // existing mocked-Prisma unit test.
  it('returns the identical 401 for every invalid-credential case', async () => {
    const server = app.getHttpServer() as Server;

    const noHeader = await request(server).post('/traces').send({
      name: 'x',
      agentName: 'x',
      startedAt: new Date().toISOString(),
    });
    const malformed = await request(server)
      .post('/traces')
      .set('Authorization', 'NotBearer something')
      .send({ name: 'x', agentName: 'x', startedAt: new Date().toISOString() });
    const unknown = await request(server)
      .post('/traces')
      .set('Authorization', 'Bearer atc_this_key_was_never_issued')
      .send({ name: 'x', agentName: 'x', startedAt: new Date().toISOString() });

    expect(noHeader.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(unknown.status).toBe(401);
    const noHeaderMessage = body<ErrorResponseBody>(noHeader).message;
    const malformedMessage = body<ErrorResponseBody>(malformed).message;
    const unknownMessage = body<ErrorResponseBody>(unknown).message;
    expect(noHeaderMessage).toBe(malformedMessage);
    expect(malformedMessage).toBe(unknownMessage);
  });
});
