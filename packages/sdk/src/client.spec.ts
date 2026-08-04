import { AgentTraceClient } from './client';

// Found live during M17's own verification: a scaffold-generated
// client reading `process.env.AGENTTRACE_BASE_URL` with no value set
// previously reached `.replace()` on `undefined` deep inside
// HttpTransport, a confusing crash unrelated to the actual mistake.
describe('AgentTraceClient constructor validation', () => {
  it('throws a clear error when apiKey is missing', () => {
    expect(
      () =>
        new AgentTraceClient({
          apiKey: '',
          baseUrl: 'http://localhost:3000',
        }),
    ).toThrow(/apiKey.*required/i);
  });

  it('throws a clear error when baseUrl is missing', () => {
    expect(
      () =>
        new AgentTraceClient({
          apiKey: 'test-key',
          baseUrl: undefined as unknown as string,
        }),
    ).toThrow(/baseUrl.*required/i);
  });

  it('constructs successfully when both are present', () => {
    expect(
      () =>
        new AgentTraceClient({
          apiKey: 'test-key',
          baseUrl: 'http://localhost:3000',
        }),
    ).not.toThrow();
  });
});
