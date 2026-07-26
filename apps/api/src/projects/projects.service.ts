import { Injectable, NotFoundException } from '@nestjs/common';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(orgId: string, name: string) {
    const slug = await this.uniqueSlug(orgId, name);
    return this.prisma.project.create({
      data: { orgId, name, slug },
    });
  }

  findAllForOrg(orgId: string) {
    return this.prisma.project.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Used everywhere a request claims to act on a project it does not
  // necessarily own. Returns 404 (not 403) for a project that exists but
  // belongs to a different org, so the response never confirms the
  // project's existence to a caller who has no access to it.
  async findOwnedProject(orgId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project || project.orgId !== orgId) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  private async uniqueSlug(orgId: string, name: string): Promise<string> {
    const base = slugify(name) || 'project';
    let slug = base;
    let attempt = 1;
    while (
      await this.prisma.project.findUnique({
        where: { orgId_slug: { orgId, slug } },
      })
    ) {
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
    return slug;
  }
}
