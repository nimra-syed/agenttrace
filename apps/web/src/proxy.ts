import { NextResponse, type NextRequest } from "next/server";

// Named proxy.ts, not middleware.ts, and exports `proxy`, not
// `middleware`: Next.js 16 renamed this file convention (a real,
// version-specific discovery, not something assumed from older docs,
// confirmed by an actual failed build pointing at
// https://nextjs.org/docs/messages/middleware-to-proxy). Still runs on
// every request the matcher below applies to, same mechanism as before.
//
// SESSION_COOKIE_NAME is duplicated from
// apps/api/src/auth/token.util.ts's SESSION_COOKIE_NAME on purpose: this
// file can't import apps/api's internal modules, and the name almost
// never changes.
//
// This only checks whether the cookie exists, never whether the session
// it names is still valid server-side. That is a convenience redirect,
// to avoid flashing a protected page before immediately bouncing to
// /login, it is NOT authentication. A cookie can be present but expired
// or already revoked. Every page's own data fetch still has to handle a
// real 401 from the API and redirect itself; this proxy would need an
// extra network call on every navigation to check that, which isn't
// worth paying for just to save the client-side redirect it would do
// anyway. See ADR-0012.
const SESSION_COOKIE_NAME = "agenttrace_session";
const PUBLIC_PATHS = new Set(["/login", "/signup"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (pathname === "/") {
    const destination = hasSessionCookie ? "/projects" : "/login";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (PUBLIC_PATHS.has(pathname)) {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/projects", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
