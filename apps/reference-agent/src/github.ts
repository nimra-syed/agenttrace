// Unauthenticated, read-only GitHub REST API access. No personal access
// token, no write scope, deliberately: this agent never needs write
// access to GitHub, so it was never given any.

const GITHUB_API_BASE = 'https://api.github.com';
const USER_AGENT = 'agenttrace-reference-agent';
const MAX_README_LENGTH = 4000;

export interface GithubIssue {
  title: string;
  body: string;
}

export async function fetchIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<GithubIssue> {
  const response = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issueNumber}`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT } },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub issue fetch failed: HTTP ${response.status} for ${owner}/${repo}#${issueNumber}`,
    );
  }

  const data = (await response.json()) as { title: string; body: string | null };
  return { title: data.title, body: data.body ?? '(no description)' };
}

// Truncated: this is just context for the LLM prompt, not the full file.
export async function fetchReadme(owner: string, repo: string): Promise<string> {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/readme`, {
    headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`GitHub readme fetch failed: HTTP ${response.status} for ${owner}/${repo}`);
  }

  const text = await response.text();
  return text.length > MAX_README_LENGTH
    ? `${text.slice(0, MAX_README_LENGTH)}...`
    : text;
}
