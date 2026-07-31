import { randomBytes } from 'crypto';

// Same shape and generation pattern as api-keys/api-key.util.ts
// (generateApiKey), a different prefix ('atc', AgentTrace CLI, vs
// 'atr') so the two credential types are visually distinguishable from
// the raw string alone. See ADR-0017.
const INSTALLATION_TOKEN_PREFIX = 'atc';
const SECRET_BYTES = 32;
const PREFIX_DISPLAY_LENGTH = 12;

export interface GeneratedInstallationToken {
  fullToken: string;
  tokenPrefix: string;
}

export function generateInstallationToken(): GeneratedInstallationToken {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const fullToken = `${INSTALLATION_TOKEN_PREFIX}_${secret}`;
  const tokenPrefix = fullToken.slice(0, PREFIX_DISPLAY_LENGTH);
  return { fullToken, tokenPrefix };
}

// The authorization code and PKCE verifier both use this same shape
// (high-entropy random string), reused here rather than duplicated.
export function generateOpaqueToken(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}
