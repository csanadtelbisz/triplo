import type { Trip } from '../../../shared/types';
import { segmentClimate } from '../climate/profiles';
import type { ClimateSettings } from '../climate/profiles';
import { selectedClimate } from './analytics';
import { englishCountryNames } from './englishNames';
import { countryDistances } from './parts';
import { UNASSIGNED } from './types';

export function tripCountrySummary(trip: Trip, settings: ClimateSettings) {
  const rows = new Map<string, { code: string; name: string; distance: number; impact?: number; unavailable: number }>();
  for (const segment of trip.segments) {
    if (segment.routingProfile === 'teleport') continue;
    const { result } = segmentClimate(trip, segment, settings);
    for (const [code, distance] of Object.entries(countryDistances(segment))) {
      if (distance <= 0) continue;
      const row = rows.get(code) || { code, name: code === UNASSIGNED ? 'Unassigned' : englishCountryNames[code]?.english || code, distance: 0, unavailable: 0 };
      row.distance += distance;
      if (result) row.impact = (row.impact || 0) + selectedClimate(trip, segment, result.co2eKg, code);
      else row.unavailable++;
      rows.set(code, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.code === UNASSIGNED ? 1 : b.code === UNASSIGNED ? -1 : b.distance - a.distance || a.name.localeCompare(b.name));
}
