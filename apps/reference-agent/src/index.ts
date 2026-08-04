import 'dotenv/config';
import { AgentTraceClient } from '@agenttraceai/sdk';
import { fetchIssue, fetchReadme } from './github.js';
import { analyzeIssue, DEFAULT_MODEL, PROVIDER } from './llm.js';
import { estimateCostUsd } from './pricing.js';

const DEFAULT_REPO = 'vercel/next.js';
const DEFAULT_ISSUE_NUMBER = 1;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const agentTraceApiKey = requireEnv('AGENTTRACE_API_KEY');
  const agentTraceBaseUrl = process.env.AGENTTRACE_BASE_URL ?? 'http://localhost:3000';
  const geminiApiKey = requireEnv('GEMINI_API_KEY');
  const geminiModel = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;

  const [ownerRepoArg, issueArg] = process.argv.slice(2);
  const [owner, repo] = (ownerRepoArg ?? DEFAULT_REPO).split('/');
  const issueNumber = issueArg ? Number(issueArg) : DEFAULT_ISSUE_NUMBER;

  if (!owner || !repo || Number.isNaN(issueNumber)) {
    console.error('Usage: pnpm start [owner/repo] [issueNumber]');
    process.exit(1);
  }

  const client = new AgentTraceClient({
    apiKey: agentTraceApiKey,
    baseUrl: agentTraceBaseUrl,
  });

  const resolution = await client.trace(
    {
      name: 'github-issue-investigation',
      agentName: 'github-issue-investigator',
      input: { owner, repo, issueNumber },
    },
    async (trace) => {
      const issue = await trace.span(
        { name: 'fetch-issue', type: 'TOOL' },
        async (span) => {
          const result = await fetchIssue(owner, repo, issueNumber);
          span.setOutput(result);
          return result;
        },
      );

      const readme = await trace.span(
        { name: 'fetch-readme', type: 'TOOL' },
        async (span) => {
          const result = await fetchReadme(owner, repo);
          span.setOutput({ length: result.length });
          return result;
        },
      );

      const analysis = await trace.span(
        { name: 'analyze-issue', type: 'LLM' },
        async (span) => {
          const result = await analyzeIssue({
            apiKey: geminiApiKey,
            model: geminiModel,
            issueTitle: issue.title,
            issueBody: issue.body,
            readme,
          });
          span.recordUsage({
            model: geminiModel,
            provider: PROVIDER,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            costUsd: estimateCostUsd(
              geminiModel,
              result.promptTokens,
              result.completionTokens,
            ),
          });
          span.setOutput(result.text);
          return result.text;
        },
      );

      trace.setOutput(analysis);
      return analysis;
    },
  );

  console.log(`\nInvestigated ${owner}/${repo}#${issueNumber}\n`);
  console.log('=== Proposed resolution ===\n');
  console.log(resolution);
}

main().catch((err) => {
  console.error('Investigation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
