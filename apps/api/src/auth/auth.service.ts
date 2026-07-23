import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role } from '../../generated/prisma/client.js';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import {
  SESSION_DURATION_MS,
  generateSessionToken,
  hashToken,
} from './token.util';

const BCRYPT_SALT_ROUNDS = 10;

export interface AuthResult {
  userId: string;
  token: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async signup(dto: SignupDto): Promise<AuthResult> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);
    const orgSlug = await this.uniqueOrgSlug(dto.orgName);
    const token = generateSessionToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: dto.orgName, slug: orgSlug },
      });

      const user = await tx.user.create({
        data: { email: dto.email, passwordHash, name: dto.name },
      });

      await tx.membership.create({
        data: { orgId: organization.id, userId: user.id, role: Role.OWNER },
      });

      await tx.session.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      return user;
    });

    return { userId: user.id, token };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Same error for "no such user" and "wrong password" on purpose, so a
    // failed login never reveals whether an email is registered.
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = generateSessionToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    await this.prisma.session.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    return { userId: user.id, token };
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }

  private async uniqueOrgSlug(name: string): Promise<string> {
    const base = slugify(name) || 'org';
    let slug = base;
    let attempt = 1;
    while (await this.prisma.organization.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${base}-${attempt}`;
    }
    return slug;
  }
}
