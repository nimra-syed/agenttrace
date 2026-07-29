# ADR-0013: Trace detail view (span tree, waterfall)

Status: Accepted

## Context

M7 gives you a list of runs but no way to see what happened inside one
— the spans, their timing, tokens, cost, or input/output. M8 adds a
detail page: click a trace, see its full span tree.

## Decision

### `GET /projects/:projectId/traces/:traceId`, flat, not pre-nested

Session-authenticated, added to the existing `ProjectTracesController`.
Org-scoped the same way `list()` already is
(`ProjectsService.findOwnedProject`), then confirms the trace actually
belongs to that project via the existing `findOwnedTrace` check
(previously only used by API-key-authenticated span ingestion; the
same 404-not-403 logic applies here).

Returns `TraceDetailResponse` (`{ trace, spans }`) — spans come back as
a **flat array**, ordered chronologically (`startedAt ASC, id ASC`, the
same deterministic-tiebreaker reasoning as the list endpoint's cursor
order, just ascending instead of descending: a waterfall reads top to
bottom in the order things happened). Building the parent/child tree
from `parentSpanId` is left to the frontend, not done server-side: the
frontend needs per-span timing data anyway to draw a waterfall
(position/width relative to trace duration), so it has to walk the
array regardless of whether the API pre-nests it. Keeping the response
flat keeps the wire format simple and matches `SpanRecord`'s existing
shape, which already carries `parentSpanId`.

### Tree construction: two-pass, cycle-safe, orphans visible

`buildSpanTree` (`span-waterfall.tsx`) builds every span into a node
first, then attaches it to its parent in a second pass — so a child
appearing before its parent in the array (the API's order is
chronological, not tree order) never matters. A span becomes a root,
not dropped, whenever attaching it under its stated parent wouldn't
produce a valid tree: the parent id is missing from this trace,
references itself, or would close a cycle. Cycle detection
(`isOwnAncestor`) walks the parent chain with a `seen` set before
attaching a child; anything that would cycle is redirected to root
instead of looping. Verified live: a real, deliberately injected mutual
reference (`A`'s parent is `B`, `B`'s parent is `A`, written directly to
the database since the ingestion API's own parent-must-already-exist
validation would reject constructing this through normal means)
rendered as two separate roots, no crash, no hang. A depth cap (50) is
a secondary safety net against a legitimate-but-absurdly-deep chain.

### Effective-end calculation, never wall-clock

A waterfall needs to know "how long did this trace take" to size bars,
but `trace.endedAt` (and any given span's `endedAt`) can be `null` — a
still-running trace, or data reported without one. The effective end
used for width math is `trace.endedAt ?? max(span.endedAt) ?? max(span.startedAt)
?? trace.startedAt`, deliberately never wall-clock `now`: that would
make bar widths change on every reload and disagree with the
`durationMs` the client actually reported. An unfinished span's bar
extends out to that same effective end, visually marked rather than
drawn as zero-width.

An unfinished span is labeled `"Running"` only when the trace's own
`status` is `RUNNING`; otherwise `"No end recorded"`. An unfinished
span on a non-`RUNNING` trace is inconsistent data, not an in-progress
span, and shouldn't be described as if it were.

### Trace-level tokens and cost are displayed as-is, never re-summed

`totalTokens`/`totalCostUsd` are independent, explicitly-reported
fields on `Trace` (same pattern as `durationMs`, confirmed by rereading
`CreateTraceDto`, per ADR-0008) — never derived from summing child
spans. The detail page displays them directly. Re-summing span values
client-side could disagree with what was actually reported (a trace
could legitimately include overhead not attributed to any span), which
would violate the same "don't assume, verify against what's actually
there" discipline the rest of this project follows.

### Collapsible payloads, no charting dependency

Input/output/metadata over 200 characters collapse behind a native
`<details>`/`<summary>`, closed by default — plain semantic HTML, no
component library. The waterfall itself is custom `<div>`s with
percentage-based `left`/`width` positioning and Tailwind for
type/status color, not a charting library: the visualization is simple
enough (horizontal bars on a shared timeline) that a dependency would
add more weight than it would save.

## Alternatives considered

- **Pre-nesting the span tree server-side.** Rejected: the frontend
  needs to walk the flat array for timing math regardless, so
  pre-nesting wouldn't remove that work, only add a second
  representation to keep in sync.
- **Dropping or throwing on an orphaned/cyclic span.** Rejected: this
  is exactly the kind of malformed data a future bug (not today's
  validated ingestion path, but some future out-of-order or externally
  modified data) could produce, and a detail page crashing or silently
  hiding data on bad input is worse than rendering it as a root with no
  parent.
- **A charting library for the waterfall.** Rejected: the visualization
  needed here (bars on a shared timeline, colored by type/status) is
  simple enough that plain divs are lighter-weight and easier to reason
  about than pulling in and configuring a library for it.

## Consequences

- Gain: a working span waterfall verified against real, deliberately
  varied data (nested spans, empty-span traces, running/error/success
  traces, large payloads, and malformed orphan/cycle references) in a
  real browser, not just a passing typecheck.
- Gain: the tree-building logic is defensive against malformed
  `parentSpanId` data by construction, not by assuming ingestion always
  produces a valid tree.
- Give up: a depth-capped waterfall will silently stop rendering
  further nesting past 50 levels, showing a count of hidden spans
  instead. Acceptable: real traces are nowhere near this deep, and the
  cap exists as a safety margin, not an expected case.
