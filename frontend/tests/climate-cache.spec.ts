import { test, expect } from '@playwright/test';
import type { Segment, Trip } from '../../shared/types';
import { getClimateSettings, segmentClimate, withClimateCache } from '../src/climate/profiles';
import type { ClimateSettings } from '../src/climate/profiles';
import { attachCountryParts, sameCountryInputs, tripForStorage, withSavedCountryParts } from '../src/countries/cache';
import { serializeTrip } from '../src/utils/serializeTrip';
import { computeTripCaches } from '../src/utils/distance';
import { segmentKey } from '../src/countries/types';
import { CountryPartitioner } from '../src/countries/partition';

const settings: ClimateSettings = { profiles: [], builtIn: {}, custom: [] };
const segment: Segment = { id: 'car', transportMode: 'car', routingService: 'manual', routingProfile: 'straight', source: 'manual',
  climateProfile: { mode: 'car', fuelType: 'petrol', exactFuelLPer100Km: 6, occupancy: 2 },
  distanceStats: { totalDistance: 100, elevationUp: 0, elevationDown: 0, hasElevation: false },
  waypoints: [{ id: 'a', coordinates: [19, 47] }, { id: 'b', coordinates: [20, 47] }],
};
const trip: Trip = { id: 'trip', name: 'Trip', startDate: '2026-05-01', createdAt: '', updatedAt: '', segments: [segment] };

test('segment climate results persist and are reused after JSON reload without recalculation', () => {
  const cached = withClimateCache(trip, settings);
  expect(trip.segments[0].climateImpact).toBeUndefined();
  expect(cached.segments[0].climateImpact?.result?.co2eKg).toBeCloseTo(7.96782);
  expect(withClimateCache(cached, settings)).toBe(cached);
  const restored: Trip = JSON.parse(serializeTrip(cached));
  const hydrated = withClimateCache(restored, settings);
  expect(hydrated.segments[0].climateImpact?.result).toEqual(cached.segments[0].climateImpact?.result);
  expect(withClimateCache(hydrated, settings)).toBe(hydrated);
  expect(segmentClimate(hydrated, hydrated.segments[0], settings)).toBe(hydrated.segments[0].climateImpact);
  expect(restored.segments[0].climateImpact?.result?.factorSets.defra?.yearUsed).toBe(2026);
  const renamed = { ...restored, name: 'Renamed trip', segments: [{ ...restored.segments[0], name: 'Renamed segment' }] };
  expect(withClimateCache(renamed, settings).segments[0].climateImpact?.result).toEqual(cached.segments[0].climateImpact?.result);
});

test('distance, date, algorithm, profile and calculator revisions invalidate the cache', () => {
  const cached = withClimateCache(trip, settings);
  const original = cached.segments[0];
  const variants: Trip[] = [
    { ...cached, startDate: '2025-05-01' },
    { ...cached, segments: [{ ...original, distanceStats: { ...original.distanceStats!, totalDistance: 200 } }] },
    { ...cached, segments: [{ ...original, climateProfile: { mode: 'car', fuelType: 'petrol', exactFuelLPer100Km: 6, occupancy: 4 } }] },
    { ...cached, segments: [{ ...original, climateProfile: { mode: 'bus' } }] },
    { ...cached, segments: [{ ...original, climateImpact: { ...original.climateImpact!, inputKey: 'obsolete-calculator-data' } }] },
  ];
  for (const variant of variants) {
    const next = withClimateCache(variant, settings);
    expect(next.segments[0].climateImpact).not.toBe(variant.segments[0].climateImpact);
    expect(next.segments[0].climateImpact?.error).toBeUndefined();
    expect(withClimateCache(next, settings)).toBe(next);
  }
  expect(withClimateCache(variants[1], settings).segments[0].climateImpact?.result?.co2eKg).toBeCloseTo(15.93564);
  expect(withClimateCache(variants[2], settings).segments[0].climateImpact?.result?.co2eKg).toBeCloseTo(3.98391);
});

test('transport defaults and trip defaults refresh the cache after preference changes', () => {
  const inherited = { ...trip, segments: [{ ...segment, climateProfile: undefined }] };
  const cached = withClimateCache(inherited, settings);
  const preferred: ClimateSettings = { ...settings, profiles: [{ id: 'none', name: 'No emissions', profile: { mode: 'none' } }], builtIn: { car: { climateProfileId: 'none' } } };
  expect(withClimateCache(cached, preferred).segments[0].climateImpact?.result?.co2eKg).toBe(0);
  const scoped = { ...cached, climateProfiles: { car: { custom: { mode: 'bus' as const } } } };
  expect(withClimateCache(scoped, settings).segments[0].climateImpact?.result?.co2eKg).toBeCloseTo(4.604);
});

test('country-part arrival updates electric caches and saved compact segments retain their climate result', () => {
  const electric = { ...trip, segments: [{ ...segment, climateProfile: { mode: 'car' as const, fuelType: 'bev' as const } }] };
  const cached = withClimateCache(electric, settings);
  const parts = [{ country: 'HU', geometry: { type: 'LineString' as const, coordinates: [[19, 47], [20, 47]] }, distanceStats: segment.distanceStats! }];
  const updated = attachCountryParts([cached], { [segmentKey(trip.id, segment.id)]: parts })[0];
  expect(sameCountryInputs(cached.segments[0], updated.segments[0])).toBe(true);
  expect(updated.segments[0].climateImpact?.inputKey).not.toBe(cached.segments[0].climateImpact?.inputKey);
  expect(updated.segments[0].climateImpact?.result?.factorSets.grid?.level).toBe('country');
  const saved = tripForStorage(updated);
  expect(saved.segments[0].distanceStats).toBeUndefined();
  expect(saved.segments[0].climateImpact).toBe(updated.segments[0].climateImpact);
  expect(withClimateCache(JSON.parse(serializeTrip(updated)), getClimateSettings()).segments[0].climateImpact?.inputKey).toBe(updated.segments[0].climateImpact?.inputKey);
  expect(withSavedCountryParts(updated, cached).segments[0].climateImpact).toBe(cached.segments[0].climateImpact);
});

test('distance-cache computation attaches climate results; errors and teleport results are cached independently', () => {
  const computed = computeTripCaches(trip);
  expect(computed.segments[0].climateImpact?.result?.co2eKg).toBeGreaterThan(0);
  const invalid = { ...trip, startDate: 'invalid' };
  const failed = withClimateCache(invalid, settings);
  expect(failed.segments[0].climateImpact?.error).toContain('Invalid date');
  expect(withClimateCache(failed, settings)).toBe(failed);
  const teleport = withClimateCache({ ...failed, segments: [{ ...failed.segments[0], routingProfile: 'teleport' }] }, settings);
  expect(teleport.segments[0].climateImpact?.result?.co2eKg).toBe(0);
  expect(teleport.segments[0].climateImpact?.error).toBeUndefined();
  const reference = { ...trip, metadata: { isSharedTripReference: true } };
  expect(withClimateCache(reference, settings)).toBe(reference);
});

test('cold reload reuses climate caches after multi-country and flight distance hydration', () => {
  const polygon = (west: number, east: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[west, -2], [east, -2], [east, 2], [west, 2], [west, -2]]] });
  const partitioner = new CountryPartitioner(['AA', 'BB'].map((code, i) => ({ code, territorial: polygon(i ? 0 : -2, i ? 2 : 0), land: polygon(i ? 0 : -2, i ? 2 : 0) })));
  const route = (id: string, mode: Segment['transportMode'], coordinates: [number, number][]): Segment => ({ id, transportMode: mode, source: 'manual', routingProfile: 'straight', routingService: 'manual', geometry: { type: 'LineString', coordinates }, waypoints: coordinates.map((coordinates, i) => ({ id: `${id}-${i}`, coordinates })) });
  const initial = computeTripCaches({ ...trip, segments: [route('drive', 'car', [[-1, 0], [1, 0], [-1, 0]]), route('flight', 'flight', [[-1, .1], [1, .1]])] });
  const parts = Object.fromEntries(initial.segments.map(segment => {
    const steps = partitioner.splitSegmentSteps(segment);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return [segmentKey(trip.id, segment.id), step.value];
  }));
  const split = attachCountryParts([initial], parts)[0];
  const stored: Trip = JSON.parse(serializeTrip(split));
  const restored = computeTripCaches(stored);
  expect(restored.segments.map(s => s.climateImpact?.inputKey)).toEqual(stored.segments.map(s => s.climateImpact?.inputKey));
  expect(serializeTrip(withSavedCountryParts(restored, stored))).toBe(serializeTrip(restored));
});

test('compact JSON omits default result fields and encodes zero emissions with one short marker', () => {
  const cached = withClimateCache({ ...trip, segments: [
    { ...segment, id: 'none', climateProfile: { mode: 'none' } },
    segment,
    { ...segment, id: 'electric', climateProfile: { mode: 'car', fuelType: 'bev' }, countryDistances: { HU: 100 } },
    { ...segment, id: 'bus', climateProfile: { mode: 'bus' } },
    { ...segment, id: 'rail', climateProfile: { mode: 'rail' }, countryDistances: { HU: 100 } },
    { ...segment, id: 'aircraft', climateProfile: { mode: 'flight', aircraftType: 'A20N' } },
    { ...segment, id: 'ferry', climateProfile: { mode: 'ferry' } },
    { ...segment, id: 'fallback', climateProfile: { mode: 'flight', aircraftType: 'UNKNOWN' } },
  ] }, settings);
  const serialized = serializeTrip(cached);
  const stored: Trip = JSON.parse(serialized);
  expect(stored.segments[0].climateImpact).toEqual({ inputKey: 'none' });
  expect(JSON.stringify(stored.segments[0].climateImpact).length).toBeLessThan(25);
  expect(stored.segments[1].climateImpact?.result).not.toHaveProperty('scope');
  expect(stored.segments[1].climateImpact?.result).not.toHaveProperty('status');
  expect(stored.segments[1].climateImpact?.result).not.toHaveProperty('warnings');
  expect(stored.segments[2].climateImpact?.result).not.toHaveProperty('directKg');
  expect(stored.segments[7].climateImpact?.result?.status).toBe('fallback');
  expect(stored.segments[7].climateImpact?.result?.warnings.length).toBeGreaterThan(0);
  const restored = withClimateCache(stored, settings);
  expect(restored.segments.map(s => s.climateImpact?.result)).toEqual(cached.segments.map(s => s.climateImpact?.result));
  expect(withClimateCache(restored, settings)).toBe(restored);
  expect(serializeTrip(restored)).toBe(serialized);
  expect(JSON.parse(serializeTrip(restored, false))).toEqual(stored);
  // Expanded caches from previous versions remain supported as well.
  const expanded: Trip = JSON.parse(JSON.stringify(cached));
  expect(withClimateCache(expanded, settings)).toBe(expanded);
});

test('a restored zero marker invalidates when the segment starts emitting and errors remain intact', () => {
  const cached = withClimateCache({ ...trip, segments: [{ ...segment, climateProfile: { mode: 'none' } }] }, settings);
  const stored: Trip = JSON.parse(serializeTrip(cached));
  expect(segmentClimate(stored, stored.segments[0], settings).result?.co2eKg).toBe(0);
  const emitting = withClimateCache({ ...stored, segments: [{ ...stored.segments[0], climateProfile: { mode: 'bus' } }] }, settings);
  expect(emitting.segments[0].climateImpact?.result?.co2eKg).toBeGreaterThan(0);
  expect(emitting.segments[0].climateImpact?.inputKey).not.toBe('none');
  const invalid = withClimateCache({ ...trip, startDate: 'invalid' }, settings);
  const restored: Trip = JSON.parse(serializeTrip(invalid));
  expect(withClimateCache(restored, settings)).toBe(restored);
  expect(restored.segments[0].climateImpact?.error).toContain('Invalid date');
});
