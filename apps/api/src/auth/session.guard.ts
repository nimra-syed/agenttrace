import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from './current-user.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SESSION_COOKIE_NAME, hashToken } from './token.util';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = (request.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE_NAME
    ];
    if (!token) {
      throw new UnauthorizedException('Not signed in');
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { memberships: true } } },
    });

    if (!session || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    // MVP simplification: every user has exactly one org membership,
    // created at signup. Revisit once a user can belong to multiple orgs.
    const membership = session.user.memberships[0];
    const authenticatedUser: AuthenticatedUser = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      orgId: membership.orgId,
      role: membership.role,
    };

    (request as Request & { user: AuthenticatedUser }).user = authenticatedUser;
    return true;
  }
}
