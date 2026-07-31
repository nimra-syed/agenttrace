import { codeChallengesMatch, computeCodeChallenge } from './pkce.util';

describe('computeCodeChallenge', () => {
  it('is deterministic: the same verifier always produces the same challenge', () => {
    const verifier = 'a-fixed-verifier-value';
    expect(computeCodeChallenge(verifier)).toBe(computeCodeChallenge(verifier));
  });

  it('produces different challenges for different verifiers', () => {
    expect(computeCodeChallenge('verifier-a')).not.toBe(
      computeCodeChallenge('verifier-b'),
    );
  });
});

describe('codeChallengesMatch', () => {
  it('matches a challenge recomputed from the same verifier', () => {
    const verifier = 'a-real-verifier';
    const challenge = computeCodeChallenge(verifier);
    expect(codeChallengesMatch(computeCodeChallenge(verifier), challenge)).toBe(
      true,
    );
  });

  it('rejects a challenge recomputed from a different verifier', () => {
    const challenge = computeCodeChallenge('the-real-verifier');
    expect(
      codeChallengesMatch(
        computeCodeChallenge('a-guessed-verifier'),
        challenge,
      ),
    ).toBe(false);
  });

  it('rejects mismatched lengths without throwing', () => {
    expect(codeChallengesMatch('short', 'a-much-longer-value')).toBe(false);
  });
});
