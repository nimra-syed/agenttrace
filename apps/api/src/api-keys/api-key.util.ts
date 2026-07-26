import { randomBytes } from 'crypto';

const API_KEY_PREFIX = 'atr';
const SECRET_BYTES = 32;
const PREFIX_DISPLAY_LENGTH = 12;

export interface GeneratedApiKey {
  fullKey: string;
  keyPrefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const fullKey = `${API_KEY_PREFIX}_${secret}`;
  const keyPrefix = fullKey.slice(0, PREFIX_DISPLAY_LENGTH);
  return { fullKey, keyPrefix };
}
