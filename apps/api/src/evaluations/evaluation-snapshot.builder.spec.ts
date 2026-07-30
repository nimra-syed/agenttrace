import {
  buildEvaluationSnapshot,
  MAX_FIELD_CHARS,
  MAX_SPANS,
  MAX_TOTAL_SNAPSHOT_CHARS,
} from './evaluation-snapshot.builder';

function fakeTrace(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trace-1',
    projectId: 'project-1',
    externalTraceId: null,
    name: 'run',
    agentName: 'agent',
    status: 'SUCCESS',
    input: { question: 'why' },
    output: { answer: 'because' },
    error: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:01:00.000Z'),
    durationMs: 60000,
    totalTokens: 100,
    totalCostUsd: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

function fakeSpan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'span-1',
    traceId: 'trace-1',
    externalSpanId: null,
    parentSpanId: null,
    name: 'call-llm',
    type: 'LLM',
    status: 'SUCCESS',
    input: null,
    output: null,
    model: null,
    provider: null,
    promptTokens: null,
    completionTokens: null,
    costUsd: null,
    error: null,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
    endedAt: new Date('2026-01-01T00:00:01.000Z'),
    durationMs: 1000,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as never;
}

describe('buildEvaluationSnapshot', () => {
  it('includes trace fields and stringifies JSON input/output', () => {
    const snapshot = buildEvaluationSnapshot(fakeTrace(), []);

    expect(snapshot.trace.name).toBe('run');
    expect(snapshot.trace.agentName).toBe('agent');
    expect(snapshot.trace.status).toBe('SUCCESS');
    expect(snapshot.trace.input).toBe(JSON.stringify({ question: 'why' }));
    expect(snapshot.trace.output).toBe(JSON.stringify({ answer: 'because' }));
    expect(snapshot.trace.error).toBeNull();
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.omittedSpanCount).toBe(0);
  });

  it('orders spans chronologically regardless of input order', () => {
    const early = fakeSpan({
      id: 'span-early',
      name: 'first',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const late = fakeSpan({
      id: 'span-late',
      name: 'second',
      startedAt: new Date('2026-01-01T00:00:05.000Z'),
    });

    const snapshot = buildEvaluationSnapshot(fakeTrace(), [late, early]);

    expect(snapshot.spans.map((s) => s.name)).toEqual(['first', 'second']);
  });

  it('breaks ties on startedAt using id, matching the list/detail endpoints', () => {
    const same = new Date('2026-01-01T00:00:00.000Z');
    const b = fakeSpan({ id: 'span-b', name: 'b', startedAt: same });
    const a = fakeSpan({ id: 'span-a', name: 'a', startedAt: same });

    const snapshot = buildEvaluationSnapshot(fakeTrace(), [b, a]);

    expect(snapshot.spans.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('truncates a field longer than MAX_FIELD_CHARS and marks the snapshot truncated', () => {
    const longOutput = 'x'.repeat(MAX_FIELD_CHARS + 500);
    const snapshot = buildEvaluationSnapshot(
      fakeTrace({ output: longOutput }),
      [],
    );

    expect(snapshot.trace.output).not.toBeNull();
    expect(snapshot.trace.output!.length).toBeLessThan(longOutput.length);
    expect(snapshot.trace.output).toContain('[truncated:');
    expect(snapshot.truncated).toBe(true);
  });

  it('does not truncate a field at or under MAX_FIELD_CHARS', () => {
    const exact = 'y'.repeat(MAX_FIELD_CHARS);
    const snapshot = buildEvaluationSnapshot(fakeTrace({ output: exact }), []);

    expect(snapshot.trace.output).toBe(exact);
    expect(snapshot.truncated).toBe(false);
  });

  it('caps the number of included spans at MAX_SPANS and reports how many were omitted', () => {
    const spans = Array.from({ length: MAX_SPANS + 7 }, (_, i) =>
      fakeSpan({
        id: `span-${i}`,
        name: `span-${i}`,
        startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      }),
    );

    const snapshot = buildEvaluationSnapshot(fakeTrace(), spans);

    expect(snapshot.spans).toHaveLength(MAX_SPANS);
    expect(snapshot.omittedSpanCount).toBe(7);
    expect(snapshot.truncated).toBe(true);
    // Keeps the earliest spans (chronological priority), not an
    // arbitrary or reversed subset.
    expect(snapshot.spans[0].name).toBe('span-0');
  });

  it('keeps span count and omittedSpanCount at 0 when under the cap', () => {
    const spans = [fakeSpan()];
    const snapshot = buildEvaluationSnapshot(fakeTrace(), spans);

    expect(snapshot.spans).toHaveLength(1);
    expect(snapshot.omittedSpanCount).toBe(0);
  });

  it('handles null input/output/error without throwing', () => {
    const snapshot = buildEvaluationSnapshot(
      fakeTrace({ input: null, output: null, error: null }),
      [fakeSpan({ input: null, output: null, error: null })],
    );

    expect(snapshot.trace.input).toBeNull();
    expect(snapshot.trace.output).toBeNull();
    expect(snapshot.trace.error).toBeNull();
    expect(snapshot.spans[0].input).toBeNull();
  });

  it('truncates a span-level field the same way as a trace-level field', () => {
    const longSpanOutput = 'z'.repeat(MAX_FIELD_CHARS + 100);
    const snapshot = buildEvaluationSnapshot(fakeTrace(), [
      fakeSpan({ output: longSpanOutput }),
    ]);

    expect(snapshot.spans[0].output).toContain('[truncated:');
    expect(snapshot.truncated).toBe(true);
  });

  it('never produces a snapshot serializing larger than the total-size backstop, even with many large spans', () => {
    const hugeSpans = Array.from({ length: MAX_SPANS }, (_, i) =>
      fakeSpan({
        id: `span-${i}`,
        name: `span-${i}`,
        startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        input: 'a'.repeat(MAX_FIELD_CHARS),
        output: 'b'.repeat(MAX_FIELD_CHARS),
      }),
    );

    const snapshot = buildEvaluationSnapshot(fakeTrace(), hugeSpans);

    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(
      MAX_TOTAL_SNAPSHOT_CHARS,
    );
    expect(snapshot.truncated).toBe(true);
  });
});
