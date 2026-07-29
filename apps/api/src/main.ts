import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { validateCsrfSecret } from './auth/csrf.util';

// Deliberately not calling app.set('trust proxy', ...) anywhere. Confirmed
// live (see ADR-0014): the Next.js frontend's rewrite-based proxy
// (next.config.ts) does not add its own X-Forwarded-For hop the way a
// real reverse proxy would -- it relays whatever header the original
// client sent, completely unmodified. Trusting that header today would
// mean trusting a value any caller can set to anything, which would be
// worse than not trusting it: it would look like real client-IP
// filtering while being trivially bypassable. This is why
// AuthThrottlerGuard keys on the request's email instead of req.ip. If a
// real reverse proxy is ever placed in front of this stack, it would
// need to overwrite (not append to) X-Forwarded-For with what it itself
// observes, and only then would trust proxy be set, to exactly that many
// trusted hops.

async function bootstrap() {
  // Fail fast, before accepting any traffic, rather than letting a
  // missing/placeholder CSRF_SECRET surface later as a confusing runtime
  // error the first time someone logs in.
  try {
    validateCsrfSecret(process.env.CSRF_SECRET);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
