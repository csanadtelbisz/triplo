import type { Segment } from '../../../shared/types';
import { modeKey } from '../countries/analytics';

/** Segment overrides belong to a mode, including a specific custom mode. */
export function resetClimateForModeChange(previous: Segment, next: Segment): Segment {
  if (modeKey(previous) === modeKey(next)) return next;
  const updated = { ...next };
  delete updated.climateProfile;
  delete updated.climateImpact;
  return updated;
}
