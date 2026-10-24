import type { ClimateProfile, Trip } from '../../../shared/types';
import type { DataBundle } from '../../../climate/src/data';
import { defaultData } from '../../../climate/src/generated/data';
import { segmentKey } from '../countries/types';
import { resolveClimateProfile } from './profiles';
import type { ClimateSettings } from './profiles';

export interface FlightHintUsage {
  aircraft: Map<string, number>;
  airlines: Map<string, number>;
}

export function countFlightProfileUsage(trips: readonly Trip[], settings: ClimateSettings, excludeSegment?: string): FlightHintUsage {
  const usage: FlightHintUsage = { aircraft: new Map(), airlines: new Map() };
  const count = (counts: Map<string, number>, value?: string) => {
    const code = value?.trim().toUpperCase();
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  };
  for (const trip of trips) for (const segment of trip.segments) {
    if (segmentKey(trip.id, segment.id) === excludeSegment) continue;
    const profile = resolveClimateProfile(trip, segment, settings).profile;
    if (profile.mode !== 'flight') continue;
    count(usage.aircraft, profile.aircraftType);
    count(usage.airlines, profile.operator);
  }
  return usage;
}

type Hint = { code: string; name: string };

export function flightProfileHints(profile: Extract<ClimateProfile, { mode: 'flight' }>, usage: FlightHintUsage,
  data: Pick<DataBundle, 'aircraft' | 'operators' | 'layouts'> = defaultData) {
  const aircraftNames = new Map(data.aircraft.flatMap(a => a.icao.map(code => [code, a.model] as const)));
  for (const layout of data.layouts) if (!aircraftNames.has(layout.aircraft)) aircraftNames.set(layout.aircraft, layout.aircraft);
  const aircraft = [...aircraftNames].map(([code, name]) => ({ code, name }));
  const airlines = [...new Set([...Object.keys(data.operators), ...data.layouts.map(layout => layout.operator)])]
    .map(code => ({ code, name: data.operators[code]?.name || code }));
  const operator = profile.operator?.trim().toUpperCase();
  const aircraftType = profile.aircraftType?.trim().toUpperCase();
  const matchingAircraft = new Set(data.layouts.filter(layout => layout.operator === operator).map(layout => layout.aircraft));
  const matchingAirlines = new Set(data.layouts.filter(layout => layout.aircraft === aircraftType).map(layout => layout.operator));
  const rank = (hints: Hint[], query: string | undefined, related: Set<string>, restrict: boolean, counts: Map<string, number>) => {
    const search = query?.trim().toUpperCase();
    return hints.filter(hint => search
      ? hint.code.includes(search) || hint.name.toUpperCase().includes(search)
      : !restrict || related.has(hint.code))
      .sort((a, b) => Number(related.has(b.code)) - Number(related.has(a.code))
        || (counts.get(b.code) || 0) - (counts.get(a.code) || 0)
        || a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  };
  return {
    aircraft: rank(aircraft, profile.aircraftType, matchingAircraft, airlines.some(hint => hint.code === operator), usage.aircraft),
    airlines: rank(airlines, profile.operator, matchingAirlines, aircraftNames.has(aircraftType || ''), usage.airlines),
  };
}
