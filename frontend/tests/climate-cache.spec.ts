import { test, expect } from '@playwright/test';
import type { Segment, Trip } from '../../shared/types';
import { getClimateSettings, segmentClimate, withClimateCache } from '../src/climate/profiles';
import type { ClimateSettings } from '../src/climate/profiles';
import { attachCountryParts, sameCountryInputs, tripForStorage, withSavedCountryParts } from '../src/countries/cache';
import { serializeTrip } from '../src/utils/serializeTrip';
import { computeTripCaches } from '../src/utils/distance';
import { segmentKey } from '../src/countries/types';
import { CountryPartitioner } from '../src/countries/partition';
import { withoutClimateResults } from '../src/climate/cache';

const settings: ClimateSettings = { profiles: [], builtIn: {}, custom: [] };
const segment: Segment = { id: 'car', transportMode: 'car', routingService: 'manual', routingProfile: 'straight', source: 'manual',
  climateProfile: { mode: 'car', fuelType: 'petrol', exactFuelLPer100Km: 6, occupancy: 2 },
  distanceStats: { totalDistance: 100, elevationUp: 0, elevationDown: 0, hasElevation: false },
  waypoints: [{ id: 'a', coordinates: [19, 47] }, { id: 'b', coordinates: [20, 47] }],
};
const trip: Trip = { id: 'trip', name: 'Trip', startDate: '2026-05-01', createdAt: '', updatedAt: '', segments: [segment] };

test('segment results are cached in memory and recalculated after JSON reload', () => {
  const cached = withClimateCache(trip, settings);
  expect(trip.segments[0].climateImpact).toBeUndefined();
  expect(cached.segments[0].climateImpact?.result?.co2eKg).toBeCloseTo(7.96782);
  expect(withClimateCache(cached, settings)).toBe(cached);
  const restored: Trip = JSON.parse(serializeTrip(cached));
  expect(restored.segments[0].climateImpact).toBeUndefined();
  const hydrated = withClimateCache(restored, settings);
  expect(hydrated.segments[0].climateImpact?.result).toEqual(cached.segments[0].climateImpact?.result);
  expect(withClimateCache(hydrated, settings)).toBe(hydrated);
  expect(segmentClimate(hydrated, hydrated.segments[0], settings)).toBe(hydrated.segments[0].climateImpact);
  expect(hydrated.segments[0].climateImpact).not.toBe(cached.segments[0].climateImpact);
  expect(hydrated.segments[0].climateImpact?.result?.factorSets.defra?.yearUsed).toBe(2026);
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

test('automatic bus caches refresh across 10 km and replace estimates from the old default rules', () => {
  const bus: Segment = { ...segment, climateProfile: { mode: 'bus' }, distanceStats: { ...segment.distanceStats!, totalDistance: 9.999 } };
  const local = withClimateCache({ ...trip, segments: [bus] }, settings);
  const entry = local.segments[0].climateImpact!;
  expect(entry.result?.co2eKg).toBeCloseTo(1.57244274, 10);
  const key = JSON.parse(entry.inputKey);
  key.revision = key.revision.replace(/^\d+:/, '5:');
  const old = { ...local, segments: [{ ...local.segments[0], climateImpact: { inputKey: JSON.stringify(key), result: { ...entry.result!, co2eKg: .46035396 } } }] };
  expect(withClimateCache(old, settings).segments[0].climateImpact?.result).toEqual(entry.result);
  // The cache rounds insignificant distance noise; crossing the bus threshold must still change its key.
  const nearlyTen = withClimateCache({ ...local, segments: [{ ...local.segments[0], distanceStats: { ...bus.distanceStats!, totalDistance: 9.999999999999998 } }] }, settings);
  expect(nearlyTen.segments[0].climateImpact?.result?.factorKeys).toEqual(['bus.local.ttw', 'bus.local.wtt']);
  const longer = withClimateCache({ ...nearlyTen, segments: [{ ...nearlyTen.segments[0], distanceStats: { ...bus.distanceStats!, totalDistance: 10 } }] }, settings);
  expect(longer.segments[0].climateImpact?.result?.co2eKg).toBeCloseTo(.4604, 10);
  expect(longer.segments[0].climateImpact?.result?.factorKeys).toEqual(['bus.coach.ttw', 'bus.coach.wtt']);
  const restored = withClimateCache(JSON.parse(serializeTrip(longer)), settings);
  expect(restored.segments[0].climateImpact?.result).toEqual(longer.segments[0].climateImpact?.result);
  expect(withClimateCache(restored, settings)).toBe(restored);
});

test('old electric rail estimates are ignored and benchmark metadata is recalculated on load', () => {
  for (const railType of ['inter_city', 'high_speed'] as const) {
    const train: Segment = { ...segment, climateProfile: { mode: 'rail', railType, traction: 'electric' }, countryDistances: { HU: 75, DE: 25 } };
    const current = withClimateCache({ ...trip, segments: [train] }, settings);
    const entry = current.segments[0].climateImpact!;
    const key = JSON.parse(entry.inputKey);
    key.revision = '4:3b8b06da5efff08942007e96fedbfccc93a24ad0bb5045d0b54974826b08ab3c';
    const old = { ...current, segments: [{ ...current.segments[0], climateImpact: { inputKey: JSON.stringify(key), result: { ...entry.result!, co2eKg: 999 } } }] };
    const refreshed = withClimateCache(old, settings);
    expect(refreshed.segments[0].climateImpact?.result).toEqual(entry.result);
    expect(refreshed.segments[0].climateImpact?.inputKey).toBe(entry.inputKey);
    const stored: Trip = JSON.parse(serializeTrip(refreshed));
    expect(stored.segments[0].climateImpact).toBeUndefined();
    const hydrated = withClimateCache(stored, settings);
    expect(hydrated.segments[0].climateImpact?.result).toEqual(entry.result);
    expect(hydrated.segments[0].climateImpact?.result?.factorSets.railEnergy).toEqual({ yearUsed: 2017, source: 'French transport reporting' });
    expect(withClimateCache(hydrated, settings)).toBe(hydrated);
  }
});

test('country-part arrival updates electric results while storage omits climate results', () => {
  const electric = { ...trip, segments: [{ ...segment, climateProfile: { mode: 'car' as const, fuelType: 'bev' as const } }] };
  const cached = withClimateCache(electric, settings);
  const parts = [{ country: 'HU', geometry: { type: 'LineString' as const, coordinates: [[19, 47], [20, 47]] }, distanceStats: segment.distanceStats! }];
  const updated = attachCountryParts([cached], { [segmentKey(trip.id, segment.id)]: parts })[0];
  expect(sameCountryInputs(cached.segments[0], updated.segments[0])).toBe(true);
  expect(updated.segments[0].climateImpact?.inputKey).not.toBe(cached.segments[0].climateImpact?.inputKey);
  expect(updated.segments[0].climateImpact?.result?.factorSets.grid?.level).toBe('country');
  const saved = tripForStorage(updated);
  expect(saved.segments[0].distanceStats).toBeUndefined();
  expect(saved.segments[0].climateImpact).toBeUndefined();
  expect(withClimateCache(JSON.parse(serializeTrip(updated)), getClimateSettings()).segments[0].climateImpact?.inputKey).toBe(updated.segments[0].climateImpact?.inputKey);
  expect(withSavedCountryParts(updated, cached).segments[0].climateImpact).toBe(updated.segments[0].climateImpact);
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

test('cold reload recalculates after multi-country and flight distance hydration without dirtying the trip', () => {
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
  expect(stored.segments.every(s => !s.climateImpact)).toBe(true);
  expect(restored.segments.map(s => s.climateImpact?.inputKey)).toEqual(split.segments.map(s => s.climateImpact?.inputKey));
  restored.segments.forEach((segment, i) => {
    for (const field of ['co2eKg', 'directKg', 'upstreamKg', 'distanceKmUsed'] as const) {
      expect(segment.climateImpact!.result![field]).toBeCloseTo(split.segments[i].climateImpact!.result![field], 10);
    }
  });
  expect(serializeTrip(withSavedCountryParts(restored, stored))).toBe(serializeTrip(restored));
});

test('all algorithms omit results from storage but keep profile choices and recompute on reload', () => {
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
  expect(serialized).not.toContain('"climateImpact"');
  expect(stored.segments.map(s => s.climateProfile)).toEqual(cached.segments.map(s => s.climateProfile));
  const offline = withoutClimateResults(cached);
  expect(offline.segments.every(s => !('climateImpact' in s))).toBe(true);
  expect(offline.segments[1].distanceStats).toBe(cached.segments[1].distanceStats);
  expect(offline.segments[2].countryDistances).toBe(cached.segments[2].countryDistances);
  expect(cached.segments[7].climateImpact?.result?.warnings.length).toBeGreaterThan(0);
  const restored = withClimateCache(stored, settings);
  expect(restored.segments.map(s => s.climateImpact?.result)).toEqual(cached.segments.map(s => s.climateImpact?.result));
  expect(withClimateCache(restored, settings)).toBe(restored);
  expect(serializeTrip(restored)).toBe(serialized);
  expect(JSON.parse(serializeTrip(restored, false))).toEqual(stored);
  // Expanded caches from previous versions are discarded, even with matching keys.
  const expanded: Trip = JSON.parse(JSON.stringify(cached));
  expanded.segments[1].climateImpact!.result!.co2eKg = 999999;
  const fresh = withClimateCache(expanded, settings);
  expect(fresh.segments[1].climateImpact?.result).toEqual(cached.segments[1].climateImpact?.result);
  expect(serializeTrip(fresh)).toBe(serialized);
});

test('legacy zero markers are ignored and errors are recalculated instead of persisted', () => {
  const cached = withClimateCache({ ...trip, segments: [{ ...segment, climateProfile: { mode: 'none' } }] }, settings);
  const stored: Trip = JSON.parse(serializeTrip(cached));
  stored.segments[0].climateImpact = { inputKey: 'none' };
  expect(segmentClimate(stored, stored.segments[0], settings).result?.co2eKg).toBe(0);
  const emitting = withClimateCache({ ...stored, segments: [{ ...stored.segments[0], climateProfile: { mode: 'bus' } }] }, settings);
  expect(emitting.segments[0].climateImpact?.result?.co2eKg).toBeGreaterThan(0);
  expect(emitting.segments[0].climateImpact?.inputKey).not.toBe('none');
  const invalid = withClimateCache({ ...trip, startDate: 'invalid' }, settings);
  const restored: Trip = JSON.parse(serializeTrip(invalid));
  expect(restored.segments[0].climateImpact).toBeUndefined();
  const refreshed = withClimateCache(restored, settings);
  expect(refreshed.segments[0].climateImpact?.error).toContain('Invalid date');
  expect(withClimateCache(refreshed, settings)).toBe(refreshed);
});

test('calculation changes never affect serialized save state while profile edits do', () => {
  const inherited = { ...trip, segments: [{ ...segment, climateProfile: undefined }] };
  const cached = withClimateCache(inherited, settings);
  const preferred: ClimateSettings = { ...settings, profiles: [{ id: 'zero', name: 'Zero', profile: { mode: 'none' } }], builtIn: { car: { climateProfileId: 'zero' } } };
  const refreshed = withClimateCache(cached, preferred);
  expect(refreshed.segments[0].climateImpact?.result?.co2eKg).toBe(0);
  expect(serializeTrip(refreshed)).toBe(serializeTrip(cached));
  const legacy = { ...cached, segments: [{ ...cached.segments[0], climateImpact: { inputKey: 'obsolete', error: 'Old algorithm' } }] };
  expect(serializeTrip(legacy)).toBe(serializeTrip(refreshed));
  expect(serializeTrip({ ...refreshed, climateProfiles: { car: { custom: { mode: 'bus' } } } })).not.toBe(serializeTrip(refreshed));
  expect(serializeTrip({ ...refreshed, segments: [{ ...refreshed.segments[0], climateProfile: { mode: 'bus' } }] })).not.toBe(serializeTrip(refreshed));
});
