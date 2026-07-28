import { GoogleGenAI } from '@google/genai';

export const DEFAULT_MODEL = 'gemini-3-flash-preview';
export const PROVIDER = 'gemini';

export interface AnalysisResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export async function analyzeIssue(params: {
  apiKey: string;
  model: string;
  issueTitle: string;
  issueBody: string;
  readme: string;
}): Promise<AnalysisResult> {
  const ai = new GoogleGenAI({ apiKey: params.apiKey });

  const prompt = [
    'You are investigating a GitHub issue. Given the issue and the',
    'repository README for context, provide:',
    '1. A likely root cause',
    '2. A proposed resolution',
    'Keep the response concise, a few sentences for each.',
    '',
    `Issue title: ${params.issueTitle}`,
    `Issue body: ${params.issueBody}`,
    '',
    'Repository README (truncated for context):',
    params.readme,
  ].join('\n');

  const response = await ai.models.generateContent({
    model: params.model,
    contents: prompt,
  });

  // Gemini 3 models can generate internal "thinking" tokens
  // (usageMetadata.thoughtsTokenCount) before producing the visible
  // response. These are not part of the visible text, but they are
  // real, billed output tokens, so they're folded into completionTokens
  // here rather than silently dropped. Confirmed by inspecting a real
  // response during M6, not assumed from documentation alone.
  return {
    text: response.text ?? '(model returned no text)',
    promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
    completionTokens:
      (response.usageMetadata?.candidatesTokenCount ?? 0) +
      (response.usageMetadata?.thoughtsTokenCount ?? 0),
  };
}
