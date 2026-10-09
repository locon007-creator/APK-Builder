import type { Ranking, RankingInput } from '../../shared/types.ts';

export const RANKING_METHOD =
  'Research priority = 100 × Σ(weight × normalised input) ÷ Σ(weight of available inputs). ' +
  'Each input is normalised to 0–1 with the formula shown. Missing inputs are excluded from both sums and listed; ' +
  '"coverage" is the share of total weight that was available. Inputs marked not-applicable are excluded by design ' +
  'to avoid counting the same disclosure twice. This ranks what to research first — it is not a forecast of returns.';

export const RANKING_LIMITATIONS = [
  'A higher priority means stronger, fresher disclosed evidence — not a better investment.',
  'Weights are fixed editorial choices documented in the method; they are not fitted to past returns.',
];

export const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Half-life decay: 1 at age 0, 0.5 at one half-life. */
export const recencyScore = (ageDays: number, halfLifeDays: number) => clamp01(0.5 ** (Math.max(0, ageDays) / halfLifeDays));

export function computeRanking(inputs: RankingInput[], asOf: string, computedAt: string, extraLimitations: string[] = []): Ranking {
  const present = inputs.filter((i) => i.normalized != null);
  const wPresent = present.reduce((s, i) => s + i.weight, 0);
  const wAll = inputs.reduce((s, i) => s + i.weight, 0);
  const weighted = present.reduce((s, i) => s + i.weight * (i.normalized as number), 0);
  const score = wPresent > 0 ? Math.round((1000 * weighted) / wPresent) / 10 : 0;
  return {
    score,
    coverage: wAll > 0 ? Math.round((100 * wPresent) / wAll) / 100 : 0,
    method: RANKING_METHOD,
    inputs,
    missing: inputs.filter((i) => i.normalized == null).map((i) => i.label),
    computedAt,
    asOf,
    limitations: [...RANKING_LIMITATIONS, ...extraLimitations],
  };
}
