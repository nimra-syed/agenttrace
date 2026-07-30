import {
  Controller,
  INestApplication,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle, ThrottlerModule } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'http';
import request from 'supertest';
import { AuthThrottlerGuard } from '../auth/auth-throttler.guard';
import { EvaluationThrottlerGuard } from './evaluation-throttler.guard';

// Regression test for a real bug: ThrottlerGuard.canActivate loops over
// EVERY named throttler registered in ThrottlerModule.forRoot(), not
// just the one referenced by a route's own @Throttle() call (confirmed
// by reading @nestjs/throttler's ThrottlerGuard source). Before
// @SkipThrottle was added to both routes, the evaluate route was also
// silently checked against the 'auth' config's limit: 5, and
// login/signup were silently also checked against 'evaluate''s
// limit: 10. This mirrors the production AppModule config and the real
// controllers' guard/decorator wiring closely enough to catch that
// class of bug again if it regresses. See ADR-0016.
const EVALUATE_THROTTLE = { evaluate: { limit: 10, ttl: 60000 } };
const AUTH_THROTTLE = { auth: { limit: 5, ttl: 60000 } };

@Controller()
class TestController {
  @Post('projects/:projectId/evaluate')
  @UseGuards(EvaluationThrottlerGuard)
  @Throttle(EVALUATE_THROTTLE)
  @SkipThrottle({ auth: true })
  evaluate() {
    return { ok: true };
  }

  @Post('login')
  @UseGuards(AuthThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  @SkipThrottle({ evaluate: true })
  login() {
    return { ok: true };
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: 'auth', ttl: 60000, limit: 5 },
      { name: 'evaluate', ttl: 60000, limit: 10 },
    ]),
  ],
  controllers: [TestController],
})
class TestModule {}

describe('named throttler scoping (evaluate vs auth)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Stands in for SessionGuard, which populates req.user in production.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: unknown }).user = { id: 'user-1' };
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows exactly the evaluate limit (10), not the lower auth limit (5)', async () => {
    const agent = request(app.getHttpServer() as Server);
    for (let i = 0; i < 10; i++) {
      const res = await agent.post('/projects/project-1/evaluate');
      expect(res.status).not.toBe(429);
    }
    const eleventh = await agent.post('/projects/project-1/evaluate');
    expect(eleventh.status).toBe(429);
  });

  it('allows exactly the auth limit (5), not the higher evaluate limit (10)', async () => {
    const agent = request(app.getHttpServer() as Server);
    for (let i = 0; i < 5; i++) {
      const res = await agent
        .post('/login')
        .send({ email: 'user@example.com' });
      expect(res.status).not.toBe(429);
    }
    const sixth = await agent
      .post('/login')
      .send({ email: 'user@example.com' });
    expect(sixth.status).toBe(429);
  });
});
