# @agenttraceai/sdk

Instrumentation client for [AgentTrace](https://github.com/nimra-syed/agenttrace):
record an AI agent's LLM calls, tool calls, latency, token usage, cost,
and errors as traces and spans.

## Usage

```ts
import { AgentTraceClient } from "@agenttraceai/sdk";

const client = new AgentTraceClient({
  apiKey: process.env.AGENTTRACE_API_KEY!,
  baseUrl: process.env.AGENTTRACE_BASE_URL,
});

await client.trace(
  { name: "issue-investigation", agentName: "github-agent" },
  async (trace) => {
    const result = await trace.span(
      { name: "call-llm", type: "LLM" },
      async (span) => {
        const response = await callLlm();
        span.recordUsage({
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
        });
        return response.text;
      },
    );

    trace.setOutput(result);
  },
);
```

`client.trace()`/`trace.span()` measure timing and report to AgentTrace
automatically. A wrapped function's return value is never sent as
output automatically; call `setOutput()` explicitly when there's
something worth recording. Every outbound call fails open (a bounded
timeout, warnings that only ever describe the failure kind, never
request/response content), so a problem with AgentTrace itself can
never break or hang the agent being instrumented.

## Connecting a project

The easiest way to get an API key and get connected is
[`@agenttraceai/cli`](https://www.npmjs.com/package/@agenttraceai/cli):

```bash
npx @agenttraceai/cli init
```
