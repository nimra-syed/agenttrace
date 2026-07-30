// Every generated value is suffixed with a timestamp plus a short
// random string, so concurrent or repeated runs never collide and no
// test depends on another test's data. The @e2e.agenttrace.test /
// "E2E ..." tags exist so a person running these against the
// persistent local dev database can spot and clean up the resulting
// rows by hand -- there is no automated teardown yet. See ADR-0015.
function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${suffix()}@e2e.agenttrace.test`;
}

export function uniqueName(prefix: string): string {
  return `${prefix} ${suffix()}`;
}
