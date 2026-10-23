import type { ClimateResult } from '../../../climate/src/types';
import type { Trip } from '../../../shared/types';
import { copyEffectiveGeometryCache } from '../utils/effectiveGeometry';

const defaults: ClimateResult = {
  co2eKg: 0, directKg: 0, upstreamKg: 0, method: 'none', scope: 'wtw',
  includesRadiativeForcing: false, distanceKmUsed: 0,
  factorSets: {}, factorKeys: [], assumptions: [], warnings: [], status: 'ok',
};

export function noEmissionResult(): ClimateResult {
  return { ...defaults, factorSets: {}, factorKeys: [], assumptions: [], warnings: [] };
}

/** Results are runtime-only; retain saved profile choices and distance/country caches. */
export function withoutClimateResults(trip: Trip): Trip {
  let changed = false;
  const segments = trip.segments.map(segment => {
    if (!('climateImpact' in segment)) return segment;
    changed = true;
    const next = { ...segment };
    delete next.climateImpact;
    copyEffectiveGeometryCache(segment, next);
    return next;
  });
  return changed ? { ...trip, segments } : trip;
}
