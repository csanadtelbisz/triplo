import type { ClimateResult } from '../../../climate/src/types';
import type { SegmentClimateImpact } from '../../../shared/types';

const defaults: ClimateResult = {
  co2eKg: 0, directKg: 0, upstreamKg: 0, method: 'none', scope: 'wtw',
  includesRadiativeForcing: false, distanceKmUsed: 0,
  factorSets: {}, factorKeys: [], assumptions: [], warnings: [], status: 'ok',
};
const expanded = new WeakMap<SegmentClimateImpact, SegmentClimateImpact>();

export function noEmissionResult(): ClimateResult {
  return { ...defaults, factorSets: {}, factorKeys: [], assumptions: [], warnings: [] };
}

/** Saved JSON omits result fields whose values equal these runtime defaults. */
export function compactClimateImpact(impact: SegmentClimateImpact) {
  if (!impact.result) return impact;
  const result = Object.fromEntries(Object.entries(impact.result).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(defaults[key as keyof ClimateResult])));
  return Object.keys(result).length === 0 && !impact.error
    ? { inputKey: 'none' }
    : { ...impact, result };
}

/** Accept both older full caches and compact caches, without rerunning the calculator. */
export function restoreClimateImpact(impact: SegmentClimateImpact): SegmentClimateImpact {
  if (impact.error || (!impact.result && impact.inputKey !== 'none')) return impact;
  if (impact.result && Object.keys(defaults).every(key => key in impact.result!)) return impact;
  const cached = expanded.get(impact);
  if (cached) return cached;
  const restored = { ...impact, result: { ...noEmissionResult(), ...impact.result } };
  expanded.set(impact, restored);
  return restored;
}
