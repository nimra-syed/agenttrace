import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    session: { create: jest.Mock; deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      organization: { findUnique: jest.fn() },
      session: { create: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('signup', () => {
    it('creates an org, user, membership, and session, and never stores the plaintext password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.organization.findUnique.mockResolvedValue(null);

      prisma.$transaction.mockImplementation(
        (callback: (tx: unknown) => unknown) => {
          const tx = {
            organization: {
              create: jest.fn().mockResolvedValue({ id: 'org-1' }),
            },
            user: {
              create: jest
                .fn()
                .mockImplementation(
                  ({ data }: { data: { passwordHash: string } }) => {
                    expect(data.passwordHash).not.toBe(
                      'correct horse battery staple',
                    );
                    return Promise.resolve({ id: 'user-1' });
                  },
                ),
            },
            membership: { create: jest.fn().mockResolvedValue({}) },
            session: { create: jest.fn().mockResolvedValue({}) },
          };
          return callback(tx);
        },
      );

      const result = await authService.signup({
        email: 'demo@agenttrace.dev',
        password: 'correct horse battery staple',
        name: 'Demo User',
        orgName: 'Demo Org',
      });

      expect(result.userId).toBe('user-1');
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(20);
    });

    it('rejects signup with an email that is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        authService.signup({
          email: 'demo@agenttrace.dev',
          password: 'correct horse battery staple',
          name: 'Demo User',
          orgName: 'Demo Org',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('succeeds with the correct password and creates a session', async () => {
      const passwordHash = await bcrypt.hash('correct horse battery staple', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'demo@agenttrace.dev',
        passwordHash,
      });
      prisma.session.create.mockResolvedValue({});

      const result = await authService.login({
        email: 'demo@agenttrace.dev',
        password: 'correct horse battery staple',
      });

      expect(result.userId).toBe('user-1');
      expect(prisma.session.create).toHaveBeenCalled();
    });

    it('rejects a wrong password and an unknown email with the same error', async () => {
      const passwordHash = await bcrypt.hash('correct horse battery staple', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'demo@agenttrace.dev',
        passwordHash,
      });

      await expect(
        authService.login({
          email: 'demo@agenttrace.dev',
          password: 'wrong password',
        }),
      ).rejects.toThrow(UnauthorizedException);

      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'nobody@agenttrace.dev',
          password: 'correct horse battery staple',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
