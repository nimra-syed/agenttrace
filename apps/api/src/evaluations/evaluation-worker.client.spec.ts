import {
  BadGatewayException,
  GatewayTimeoutException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { EvaluationSnapshot } from './evaluation-snapshot.builder';
import { EvaluationWorkerClient } from './evaluation-worker.client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const VALID_SECRET = 'a'.repeat(32);
const FAKE_SNAPSHOT: EvaluationSnapshot = {
  trace: {
    name: 'run',
    agentName: 'agent',
    status: 'SUCCESS',
    input: null,
    output: null,
    error: null,
  },
  spans: [],
  truncated: false,
  omittedSpanCount: 0,
};

describe('EvaluationWorkerClient', () => {
  let fetchMock: jest.Mock;
  let client: EvaluationWorkerClient;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    process.env.EVAL_WORKER_URL = 'http://localhost:8000';
    process.env.EVAL_WORKER_SECRET = VALID_SECRET;
    client = new EvaluationWorkerClient();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('sends the snapshot and the shared secret header, and returns a valid judgment', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        score: 4,
        rationale: 'Looks correct.',
        judgeModel: 'gemini-3-flash-preview',
        evaluatorVersion: 'judge-v1',
      }),
    );

    const judgment = await client.evaluate(FAKE_SNAPSHOT);

    expect(judgment.score).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8000/evaluate');
    expect((init.headers as Record<string, string>)['X-Internal-Secret']).toBe(
      VALID_SECRET,
    );
    expect(JSON.parse(init.body as string)).toEqual(FAKE_SNAPSHOT);
  });

  it('rejects if EVAL_WORKER_SECRET is invalid at call time, not just at startup', async () => {
    process.env.EVAL_WORKER_SECRET = 'too-short';
    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a sanitized 503 on a network failure, without leaking the snapshot or the secret', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow(
      ServiceUnavailableException,
    );
    try {
      await client.evaluate(FAKE_SNAPSHOT);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(VALID_SECRET);
      expect(message).not.toContain('run'); // the snapshot's trace.name
      expect(message).not.toContain('ENOTFOUND');
    }
  });

  it('throws a 504 when the request times out (TimeoutError), distinct from an unreachable worker', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    fetchMock.mockRejectedValue(timeoutError);

    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow(
      GatewayTimeoutException,
    );
  });

  it('throws a 503 when the worker reports the provider is unavailable', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'provider down' }, 503));
    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('throws a 502 when the worker reports a malformed judge response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'bad judge output' }, 502),
    );
    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('throws a generic 500 for any other non-2xx status (e.g. an internal secret mismatch)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Invalid internal secret' }, 401),
    );
    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws a 502 when the worker responds 200 with an unexpected shape', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }));
    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow(
      BadGatewayException,
    );
    await expect(client.evaluate(FAKE_SNAPSHOT)).rejects.toThrow(
      /unexpected response shape/,
    );
  });

  it('passes an AbortSignal so the request cannot hang indefinitely', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        score: 1,
        rationale: 'x',
        judgeModel: 'm',
        evaluatorVersion: 'judge-v1',
      }),
    );

    await client.evaluate(FAKE_SNAPSHOT);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
