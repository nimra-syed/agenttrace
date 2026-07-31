import {
  generateInstallationToken,
  generateOpaqueToken,
} from './installation.util';

describe('generateInstallationToken', () => {
  it("produces a token prefixed with atc_, distinct from ApiKey's atr_ prefix", () => {
    const { fullToken } = generateInstallationToken();
    expect(fullToken.startsWith('atc_')).toBe(true);
  });

  it('returns a tokenPrefix that is a true prefix of the full token', () => {
    const { fullToken, tokenPrefix } = generateInstallationToken();
    expect(fullToken.startsWith(tokenPrefix)).toBe(true);
    expect(tokenPrefix.length).toBeLessThan(fullToken.length);
  });

  it('never repeats a generated token', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateInstallationToken().fullToken),
    );
    expect(tokens.size).toBe(20);
  });
});

describe('generateOpaqueToken', () => {
  it('never repeats a generated value', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateOpaqueToken()),
    );
    expect(tokens.size).toBe(20);
  });
});
