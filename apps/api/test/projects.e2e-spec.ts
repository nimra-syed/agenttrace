import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupTaggedTestData } from './support/cleanup';
import { createTestApp } from './support/test-app';
import {
  body,
  getCsrfHeader,
  signupAndGetAgent,
  type ProjectResponseBody,
} from './support/test-data';

describe('Projects (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await cleanupTaggedTestData(app.get(PrismaService));
    await app.close();
  });

  it('creates a project and returns it in the list afterward', async () => {
    const { agent } = await signupAndGetAgent(app);
    const csrfHeader = await getCsrfHeader(agent);

    const created = await agent
      .post('/projects')
      .set(csrfHeader)
      .send({ name: 'My Real Project' });
    const createdProject = body<ProjectResponseBody>(created);

    expect(created.status).toBe(201);
    expect(createdProject.name).toBe('My Real Project');

    const list = await agent.get('/projects');
    expect(list.status).toBe(200);
    const listedIds = body<ProjectResponseBody[]>(list).map((p) => p.id);
    expect(listedIds).toContain(createdProject.id);
  });

  // The org-scoping check this project's own security rules call out
  // explicitly: authorization checks are tested directly, not just
  // covered incidentally by happy-path tests. Two separate signups get
  // two separate orgs (ADR-0006), so this is a real, live cross-org
  // boundary, not a synthetic one.
  it("never shows one org a different org's project", async () => {
    const owner = await signupAndGetAgent(app);
    const ownerCsrf = await getCsrfHeader(owner.agent);
    const created = await owner.agent
      .post('/projects')
      .set(ownerCsrf)
      .send({ name: 'Owner-Only Project' });
    const createdProject = body<ProjectResponseBody>(created);
    expect(created.status).toBe(201);

    const outsider = await signupAndGetAgent(app);
    const outsiderList = await outsider.agent.get('/projects');

    expect(outsiderList.status).toBe(200);
    const outsiderIds = body<ProjectResponseBody[]>(outsiderList).map(
      (p) => p.id,
    );
    expect(outsiderIds).not.toContain(createdProject.id);
  });
});
