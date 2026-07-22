import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from '../generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: { name: 'Demo Org', slug: 'demo-org' },
  });

  const user = await prisma.user.upsert({
    where: { email: 'demo@agenttrace.dev' },
    update: {},
    create: {
      email: 'demo@agenttrace.dev',
      passwordHash: 'placeholder-hash-replaced-at-m2',
      name: 'Demo User',
    },
  });

  await prisma.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {},
    create: { orgId: org.id, userId: user.id, role: Role.OWNER },
  });

  const project = await prisma.project.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'demo-project' } },
    update: {},
    create: { orgId: org.id, name: 'Demo Project', slug: 'demo-project' },
  });

  console.log({ org: org.slug, user: user.email, project: project.slug });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
