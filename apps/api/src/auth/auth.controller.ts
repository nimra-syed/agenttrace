import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { AuthService } from './auth.service';
import { computeCsrfToken, CSRF_COOKIE_NAME } from './csrf.util';
import { CurrentSessionId } from './current-session-id.decorator';
import { CurrentUser, type AuthenticatedUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { Public } from './public.decorator';
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from './token.util';

const isProduction = process.env.NODE_ENV === 'production';

// Applied to signup and login specifically, not globally: see ADR-0014
// for why there's no general-purpose global throttle (it would need to
// exempt ingestion routes that legitimately see high-frequency traffic
// from a busy agent, and AuthThrottlerGuard's email-based tracking key
// only makes sense for routes that receive an email in the body).
const AUTH_THROTTLE = { auth: { limit: 5, ttl: 60000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // See EvaluationsController's evaluate() for why @SkipThrottle is
  // needed here: ThrottlerGuard applies every named throttler in
  // AppModule's config to any route it guards, not just the one named
  // in @Throttle(). Without this, signup/login were also silently
  // subject to the 'evaluate' config's limit: 10 using this guard's own
  // email/IP tracker -- harmless only because 5 < 10 masked it. See
  // ADR-0016. 'cli-token' (ADR-0017) is skipped for the same reason,
  // applied proactively this time instead of found live.
  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  @SkipThrottle({ evaluate: true, 'cli-token': true })
  @Post('signup')
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, token, sessionId } = await this.authService.signup(dto);
    this.setSessionCookie(res, token);
    this.setCsrfCookie(res, sessionId);
    return { userId };
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Throttle(AUTH_THROTTLE)
  @SkipThrottle({ evaluate: true, 'cli-token': true })
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { userId, token, sessionId } = await this.authService.login(dto);
    this.setSessionCookie(res, token);
    this.setCsrfCookie(res, sessionId);
    return { userId };
  }

  // Public on purpose: logout's whole job is to end whatever session is
  // present, valid or not. Requiring a valid session to log out means a
  // stale/expired cookie could never be cleared by calling this endpoint,
  // which is exactly the case the frontend's 401 handler needs it for.
  // Also exempt from CSRF (CsrfGuard only enforces when request.user is
  // set, which it never is here, since @Public() skips SessionGuard) --
  // a forced-logout CSRF is a minor nuisance, not a real compromise, and
  // the 401-handler's redirect-to-login flow (ADR-0012) depends on
  // logout working with no way to have fetched a fresh CSRF token first.
  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      SESSION_COOKIE_NAME
    ];
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME);
    res.clearCookie(CSRF_COOKIE_NAME);
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // Session-authenticated (no @Public()): lets an existing session (one
  // created before this endpoint existed, or one whose CSRF cookie was
  // separately lost/cleared) recover a valid CSRF cookie without a full
  // logout/login cycle. GET, so CsrfGuard never enforces on this route
  // itself regardless. See ADR-0014.
  @Get('csrf')
  @HttpCode(204)
  bootstrapCsrf(
    @CurrentSessionId() sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.setCsrfCookie(res, sessionId);
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DURATION_MS,
    });
  }

  private setCsrfCookie(res: Response, sessionId: string) {
    res.cookie(CSRF_COOKIE_NAME, computeCsrfToken(sessionId), {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_DURATION_MS,
    });
  }
}
