const MAX_ERROR_MESSAGE_LENGTH = 2000;

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

// Stack traces are deliberately excluded for M5, only the message is
// captured. A stack can be large, and can reveal local file paths;
// revisit if debugging from the dashboard alone proves insufficient. A
// non-Error thrown value is never JSON.stringify'd, since it could
// contain secrets, circular references, or very large payloads, same
// reasoning as not auto-capturing output (see ADR-0009). Only its type is
// reported.
export function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return truncate(err.message || err.name || 'Error', MAX_ERROR_MESSAGE_LENGTH);
  }
  if (typeof err === 'string') {
    return truncate(err, MAX_ERROR_MESSAGE_LENGTH);
  }
  return `Non-Error value thrown (${typeof err})`;
}
