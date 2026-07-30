import { readFileSync } from 'fs';
import { join } from 'path';
import { isEvaluationSnapshot } from './evaluation-snapshot.builder';
import { isEvaluationJudgment } from './evaluation-worker.client';

// Loads the SAME two fixture files apps/eval-worker's own tests load
// (contracts/README.md, ADR-0016). Neither side has a shared type
// system with the other -- this is what actually catches one side's
// model silently drifting from the other's, not just documentation
// saying they should match.
const CONTRACTS_DIR = join(__dirname, '../../../../contracts');

function loadFixture(name: string): unknown {
  const path = join(CONTRACTS_DIR, name);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('eval-worker contract fixtures', () => {
  it("the request fixture matches this side's EvaluationSnapshot shape", () => {
    const fixture = loadFixture('evaluation-request.example.json');
    expect(isEvaluationSnapshot(fixture)).toBe(true);
  });

  it("the response fixture matches this side's EvaluationJudgment shape", () => {
    const fixture = loadFixture('evaluation-response.example.json');
    expect(isEvaluationJudgment(fixture)).toBe(true);
  });
});
