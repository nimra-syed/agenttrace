import { HttpTransport } from './http.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('HttpTransport', () => {
  let warnSpy: jest.SpyInstance;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns the parsed response on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'trace-1' }));
    const http = new HttpTransport({
      apiKey: 'atr_test',
      baseUrl: 'http://localhost:3000',
      timeoutMs: 1000,
    });

    const result = await http.postTrace({
      name: 'run',
      agentName: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result).toEqual({ id: 'trace-1' });
  });

  it('sends the API key as a Bearer token and never in the URL', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'trace-1' }));
    const http = new HttpTransport({
      apiKey: 'atr_super_secret',
      baseUrl: 'http://localhost:3000',
      timeoutMs: 1000,
    });

    await http.postTrace({
      name: 'run',
      agentName: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('atr_super_secret');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer atr_super_secret',
    );
  });

  it('resolves to undefined, and warns without leaking the payload, on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'bad' }, 400));
    const http = new HttpTransport({
      apiKey: 'atr_test',
      baseUrl: 'http://localhost:3000',
      timeoutMs: 1000,
    });

    const result = await http.postTrace({
      name: 'run',
      agentName: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
      input: { secret: 'do-not-log-me' },
    });

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).not.toContain('do-not-log-me');
    expect(message).not.toContain('atr_test');
    expect(message).toContain('400');
  });

  it('resolves to undefined on a network error, without throwing', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const http = new HttpTransport({
      apiKey: 'atr_test',
      baseUrl: 'http://localhost:3000',
      timeoutMs: 1000,
    });

    const result = await http.postTrace({
      name: 'run',
      agentName: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result).toBeUndefined();
  });

  it('aborts and resolves to undefined when the request exceeds the timeout', async () => {
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const http = new HttpTransport({
      apiKey: 'atr_test',
      baseUrl: 'http://localhost:3000',
      timeoutMs: 20,
    });

    const result = await http.postTrace({
      name: 'run',
      agentName: 'agent',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result).toBeUndefined();
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).toContain('timed out');
  });
});
