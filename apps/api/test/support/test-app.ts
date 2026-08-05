import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

// Boots the real AppModule, not a trimmed test module: the whole point
// of this suite is proving the real global guards (SessionGuard,
// CsrfGuard), the real ThrottlerModule config, and real Prisma-backed
// services work together at the HTTP layer, not just that each class
// works in isolation (unit tests already prove that).
//
// TestingModule.createNestApplication() does NOT run main.ts's own
// bootstrap() function, so its two manual setup calls
// (cookieParser(), the global ValidationPipe) are replicated here by
// hand. Skipping either would make this suite behave differently from
// the real, running app in exactly the ways that matter most: CSRF
// depends on cookie-parser having already parsed request.cookies, and
// DTO validation depends on the same ValidationPipe options
// (whitelist/forbidNonWhitelisted/transform) main.ts configures.
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  return app;
}
