import type { HttpTransport } from './http.js';
import { runTrace, type SpanContext, type TraceContext } from './trace-context.js';

function fakeHttp(): {
  http: HttpTransport;
  postTrace: jest.Mock;
  postSpan: jest.Mock;
} {
  const postTrace = jest.fn();
  const postSpan = jest.fn();
  return { http: { postTrace, postSpan } as unknown as HttpTransport, postTrace, postSpan };
}

describe('runTrace', () => {
  it('does not use the callback return value as output', async () => {
    const { http, postTrace } = fakeHttp();
    postTrace.mockResolvedValue({ id: 'trace-1' });

    await runTrace(http, { name: 'run', agentName: 'agent' }, async () => {
      return { thisShouldNotBeSent: true };
    });

    const finishCall = postTrace.mock.calls[1][0] as { output?: unknown };
    expect(finishCall.output).toBeUndefined();
  });

  it('sends output only when setOutput is explicitly called', async () => {
    const { http, postTrace } = fakeHttp();
    postTrace.mockResolvedValue({ id: 'trace-1' });

    await runTrace(http, { name: 'run', agentName: 'agent' }, async (trace) => {
      trace.setOutput({ answer: 42 });
      return 'ignored';
    });

    const finishCall = postTrace.mock.calls[1][0] as { output?: unknown };
    expect(finishCall.output).toEqual({ answer: 42 });
  });

  it('reports SUCCESS on a normal return, and re-throws the original error on failure', async () => {
    const { http, postTrace } = fakeHttp();
    postTrace.mockResolvedValue({ id: 'trace-1' });

    await runTrace(http, { name: 'run', agentName: 'agent' }, async () => 'ok');
    expect(
      (postTrace.mock.calls[1][0] as { status: string }).status,
    ).toBe('SUCCESS');

    postTrace.mockClear();
    const boom = new Error('llm call failed');
    await expect(
      runTrace(http, { name: 'run', agentName: 'agent' }, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    const finishCall = postTrace.mock.calls[1][0] as {
      status: string;
      error?: string;
    };
    expect(finishCall.status).toBe('ERROR');
    expect(finishCall.error).toBe('llm call failed');
  });

  it('still sends a self-sufficient finish call even when the start call fails', async () => {
    const { http, postTrace } = fakeHttp();
    postTrace.mockResolvedValueOnce(undefined); // start fails
    postTrace.mockResolvedValueOnce({ id: 'trace-1' }); // finish succeeds

    await runTrace(http, { name: 'run', agentName: 'agent' }, async () => 'ok');

    expect(postTrace).toHaveBeenCalledTimes(2);
    const finishCall = postTrace.mock.calls[1][0] as {
      name: string;
      agentName: string;
      startedAt: string;
      status: string;
    };
    expect(finishCall.name).toBe('run');
    expect(finishCall.agentName).toBe('agent');
    expect(finishCall.status).toBe('SUCCESS');
  });

  it('skips span reporting entirely when the trace start call never confirms a server id, without affecting the real callback', async () => {
    const { http, postTrace, postSpan } = fakeHttp();
    postTrace.mockResolvedValue(undefined); // start and finish both "fail"

    let ran = false;
    const result = await runTrace(
      http,
      { name: 'run', agentName: 'agent' },
      async (trace: TraceContext) => {
        return trace.span({ name: 'call-llm', type: 'LLM' }, async () => {
          ran = true;
          return 'span result';
        });
      },
    );

    expect(ran).toBe(true);
    expect(result).toBe('span result');
    expect(postSpan).not.toHaveBeenCalled();
  });

  it('threads a confirmed parent span id to nested child spans', async () => {
    const { http, postTrace, postSpan } = fakeHttp();
    postTrace.mockResolvedValue({ id: 'trace-1' });
    postSpan.mockImplementation((_traceId: string, payload: { name: string }) =>
      Promise.resolve({ id: `span-${payload.name}` }),
    );

    await runTrace(http, { name: 'run', agentName: 'agent' }, async (trace) => {
      return trace.span({ name: 'parent', type: 'TOOL' }, async (span: SpanContext) => {
        return span.span({ name: 'child', type: 'LLM' }, async () => 'done');
      });
    });

    const childStartCall = postSpan.mock.calls.find(
      (call) => (call[1] as { name: string }).name === 'child',
    ) as [string, { parentSpanId?: string }];
    expect(childStartCall[1].parentSpanId).toBe('span-parent');
  });

  it('reports a child span without a parent reference when the parent span start never confirms an id', async () => {
    const { http, postTrace, postSpan } = fakeHttp();
    postTrace.mockResolvedValue({ id: 'trace-1' });
    postSpan.mockImplementation((_traceId: string, payload: { name: string }) =>
      payload.name === 'parent'
        ? Promise.resolve(undefined)
        : Promise.resolve({ id: 'span-child' }),
    );

    await runTrace(http, { name: 'run', agentName: 'agent' }, async (trace) => {
      return trace.span({ name: 'parent', type: 'TOOL' }, async (span: SpanContext) => {
        return span.span({ name: 'child', type: 'LLM' }, async () => 'done');
      });
    });

    const childStartCall = postSpan.mock.calls.find(
      (call) => (call[1] as { name: string }).name === 'child',
    ) as [string, { parentSpanId?: string }];
    expect(childStartCall[1].parentSpanId).toBeUndefined();
  });

  it('computes durationMs from a monotonic clock, not from wall-clock time', async () => {
    // If durationMs were computed by subtracting two `new Date()` values
    // instead of two performance.now() readings, this test's real,
    // unmocked wall-clock elapsed time (some small, unpredictable number
    // of milliseconds) would leak into the result instead of the exact,
    // controlled value below.
    const nowSpy = jest.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(1000); // start
    nowSpy.mockReturnValueOnce(1250); // end, exactly 250ms of monotonic time

    const { http, postTrace } = fakeHttp();
    postTrace.mockResolvedValue({ id: 'trace-1' });

    await runTrace(http, { name: 'run', agentName: 'agent' }, async () => 'ok');

    const finishCall = postTrace.mock.calls[1][0] as { durationMs: number };
    expect(finishCall.durationMs).toBe(250);

    nowSpy.mockRestore();
  });
});
