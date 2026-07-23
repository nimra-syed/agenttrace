import { Injectable } from '@nestjs/common';
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
