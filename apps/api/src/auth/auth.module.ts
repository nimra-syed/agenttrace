import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard } from './csrf.guard';
import { SessionGuard } from './session.guard';

// ThrottlerModule.forRoot() is registered once, centrally, in
// AppModule -- not here. @nestjs/throttler's ThrottlerModule is
// @Global(), and registering forRoot() a second time in a different
// feature module (as EvaluationsModule's own throttle config initially
// did, ADR-0016) risks one registration silently shadowing the other,
// since Nest resolves a @Global() dynamic module's providers once, not
// per-importer. All named throttler configs across the app live in one
// array in one place instead.
@Module({
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
