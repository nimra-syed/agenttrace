import { randomBytes } from 'crypto';

export const SESSION_COOKIE_NAME = 'agenttrace_session';
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
