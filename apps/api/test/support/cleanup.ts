import type { PrismaService } from '../../src/prisma/prisma.service';
import { TEST_EMAIL_DOMAIN } from './test-data';

// Called from each spec file's own afterAll, using that file's already-
// connected PrismaService (app.get(PrismaService)) -- not a separately
// constructed PrismaClient, and deliberately not Jest's globalTeardown
// hook. globalTeardown loads its script through a different mechanism
// (`requireOrImportModule`) that bypasses Jest's own configured
// resolver entirely, which is exactly what this project's
// moduleNameMapper (needed for Prisma 7's generated-client.ts's own
// internal .js-suffixed-but-actually-.ts imports) depends on. Found
// live: a globalTeardown version of this file threw "Cannot find
// module '.../client.js'" every time, even though the exact same import
// resolves fine inside a normal spec file. Running once per file, in
// series (--runInBand), sweeps this suite's own tagged data as it goes
// rather than letting it accumulate for the whole run.
//
// Deletes only rows reachable from users tagged with TEST_EMAIL_DOMAIN,
// in strict child-before-parent order per the real schema -- never a
// broad truncate, and never anything belonging to real dev data or
// Playwright's own @e2e.agenttrace.test rows.
export async function cleanupTaggedTestData(
  prisma: PrismaService,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;

  const memberships = await prisma.membership.findMany({
    where: { userId: { in: userIds } },
    select: { orgId: true },
  });
  const orgIds = [...new Set(memberships.map((m) => m.orgId))];

  // Defensive, not just optimistic: only ever delete an organization if
  // every membership on it belongs to a tagged user. Today's product
  // creates exactly one dedicated org per signup (ADR-0006), so this
  // should always be true for orgs this suite created -- the check
  // means a future change to that assumption (e.g. inviting a real
  // user into a test org) fails safe by skipping deletion, rather than
  // deleting an org a real user happens to share.
  const safeOrgIds: string[] = [];
  for (const orgId of orgIds) {
    const orgMemberships = await prisma.membership.findMany({
      where: { orgId },
      select: { userId: true },
    });
    if (orgMemberships.every((m) => userIds.includes(m.userId))) {
      safeOrgIds.push(orgId);
    }
  }
  if (safeOrgIds.length === 0) return;

  const projects = await prisma.project.findMany({
    where: { orgId: { in: safeOrgIds } },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);

  const installations = await prisma.installation.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  });
  const installationIds = installations.map((i) => i.id);

  const traces = await prisma.trace.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  });
  const traceIds = traces.map((t) => t.id);

  // Children before parents, all the way down.
  await prisma.evalResult.deleteMany({ where: { traceId: { in: traceIds } } });
  await prisma.span.deleteMany({ where: { traceId: { in: traceIds } } });
  await prisma.trace.deleteMany({ where: { id: { in: traceIds } } });
  await prisma.cliAuthorizationCode.deleteMany({
    where: { installationId: { in: installationIds } },
  });
  await prisma.installation.deleteMany({
    where: { id: { in: installationIds } },
  });
  await prisma.apiKey.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: safeOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
