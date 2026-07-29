import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { SessionGuard } from './session.guard';

@Module({
  imports: [ThrottlerModule.forRoot([{ name: 'auth', ttl: 60000, limit: 5 }])],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Order matters: NestJS runs multiple APP_GUARD providers in
    // registration order. CsrfGuard needs request.user/request.sessionId,
    // which only exist once SessionGuard has already run, so SessionGuard
    // must be registered first. See ADR-0014.
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AuthModule {}
