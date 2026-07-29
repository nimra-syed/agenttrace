# ADR-0011: GET /projects/:projectId/traces (list endpoint)

Status: Accepted

## Context

M4 built ingestion (`POST /traces`, `POST /traces/:traceId/spans`), but
nothing reads trace data back out. The dashboard (M7) needs a way for a
signed-in person, not an API key holder, to list the traces reported for
one of their projects, filtered and paginated.

## Decision

`GET /projects/:projectId/traces`, session-authenticated, living in a new
`ProjectTracesController`, separate from the existing API-key-authenticated
`TracesController`. Same split as `ApiKeysController` versus
`ApiKeyAuthController` in the api-keys module: which guard applies
depends on who is calling, a person with a session or a script with a
key, not on which resource is involved.

### Cursor pagination, ordered by (startedAt, id), both fields

`OFFSET n LIMIT m` gets slower as `n` grows, since the database still has
to scan past every skipped row, and it's unstable if rows are inserted
while someone is paging through, a row can be skipped or repeated across
pages. Keyset (cursor) pagination avoids both: each page asks for rows
older than a specific `(startedAt, id)` already seen, which stays fast at
any table size and stays consistent regardless of concurrent writes.
This directly uses the `(projectId, startedAt DESC)` index already
built in M1 for exactly this query pattern (ADR-0003).

`startedAt` alone is not a deterministic sort key. Multiple traces can
share the exact same timestamp (two spans started in the same
millisecond, or synthetic test data), and without a tiebreaker, ties
could come back in a different order across requests, silently
skipping or duplicating a row at a page boundary. `id` (a UUID) doesn't
need to be meaningfully ordered, a tiebreaker only needs to be stable
and unique, so ordering by `(startedAt DESC, id DESC)` and expressing
the cursor as `(startedAt, id) < (cursorStartedAt, cursorId)` (built as
an `OR` of two conditions, Prisma has no direct row-value comparison
syntax) is enough. Verified live: walked all three test traces one page
at a time (`limit=1`) and got the correct trace on each page, in order,
with `nextCursor` correctly `null` on the last page.

The cursor itself is a base64url-encoded opaque token, callers are not
meant to construct or parse it themselves, only pass back exactly what
they were given.

### An explicit response type, not Prisma models returned as-is

`ListTracesResponse` (`packages/shared-types`) is `{ items: TraceRecord[],
nextCursor: string | null }`. This is not just a style preference.
Verified directly while building this endpoint: Prisma's `Decimal` type
(used for `totalCostUsd`) serializes to a JSON **string** by default
(`"12.34"`), not a number, confirmed both with a standalone script and
live over a real HTTP response from the existing (unfixed) `POST
/traces`. `TraceRecord.totalCostUsd` has always been typed `number |
null` since M5, a latent, previously untriggered mismatch between the
documented wire contract and what Prisma would actually put on the
wire if its object were returned directly. `toTraceRecord` (a small,
explicit mapper) converts `Decimal` to a real number with `.toNumber()`
and `Date` to an ISO string, so the new endpoint's response actually
matches what `TraceRecord` promises. Verified live: a trace created with
`totalCostUsd: 12.34` came back from `POST /traces` as the string
`"12.34"`, and from this new `GET` endpoint as the number `12.34`.

**Update**: `POST /traces` and `POST /traces/:traceId/spans` (M4) had the
exact same latent issue, they returned Prisma's raw row directly. Once
`toTraceRecord` existed and was tested, applying it (and a matching
`toSpanRecord`) to those two endpoints turned out to be a small, low-risk
change (wrap an existing return value, no routing/auth/validation
changes), so it was fixed in this same checkpoint rather than carried
forward as debt. Verified live: `POST /traces` with `totalCostUsd: 7.89`
now returns the number `7.89`, and a span with `costUsd: 3.21` returns
the number `3.21`, both confirmed via Python's `json` module reporting
`float`, not `str`.

### Filters: status, agentName (partial, case-insensitive), a date range

`status` is an exact match against the `TraceStatus` enum. `agentName`
is a `contains`, case-insensitive match, exact-match felt too rigid for
a free-text field a project might use inconsistently across agents.
`from` / `to` filter on `startedAt`, both optional independently.

## Alternatives considered

- **Offset/limit pagination.** Rejected, see above; not meaningfully
  simpler to implement than cursor pagination here, and the index
  already built for this query pattern favors cursor.
- **Returning Prisma's trace objects directly**, typed loosely as
  `unknown` or `any` at the controller boundary. Rejected: this is
  exactly what would have silently shipped the `Decimal`-as-string bug
  into a real API response instead of catching it before it went out.
- **A single shared controller for both API-key and session
  authenticated trace routes.** Rejected, for the same reason
  `ApiKeysController` and `ApiKeyAuthController` are already separate:
  the two callers (a script, a browser session) have different
  authentication mechanisms and different authorization questions to
  answer, conflating them into one controller with conditional guard
  logic would be harder to reason about than two small, single-purpose
  controllers.

## Consequences

- Gain: a list endpoint whose pagination stays correct and fast as trace
  volume grows, a response contract that's actually true, not just
  documented as true, and (once extended to `toSpanRecord`) the same
  correctness for every trace/span endpoint in the API, not just the new
  one.
- Give up: the cursor is opaque and one-directional (next page only, no
  "go back three pages" or "jump to page 5"), a real limitation of
  keyset pagination in general, acceptable for a dashboard's default
  "load more" pattern.
