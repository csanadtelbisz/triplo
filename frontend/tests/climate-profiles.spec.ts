import { test, expect } from '@playwright/test';
import type { ClimateProfile, Segment, Trip } from '../../shared/types';
import { calculate } from '../../climate/src/calculate';
import { builtInClimateProfile, builtInClimateProfiles, namedProfileChoice, resolveClimateProfile, routeCountryShares, segmentClimate, tripClimate } from '../src/climate/profiles';
import type { ClimateSettings } from '../src/climate/profiles';
import { countryYearDistances, emptyAnalyticsSelection } from '../src/countries/analytics';
import { serializeTrip } from '../src/utils/serializeTrip';

const segment: Segment = { id: 'car', transportMode: 'car', source: 'manual', routingService: 'manual', routingProfile: 'straight', waypoints: [], distanceStats: { totalDistance: 100, elevationUp: 0, elevationDown: 0, hasElevation: false } };
const trip: Trip = { id: 'trip', name: 'Trip', createdAt: '', updatedAt: '', startDate: '2026-06-01', segments: [segment] };
const profile = { id: 'own-car', name: 'My car', profile: { mode: 'car', fuelType: 'petrol', exactFuelLPer100Km: 6, occupancy: 2 } as ClimateProfile };
const settings: ClimateSettings = { profiles: [profile], builtIn: { car: { climateProfileId: 'own-car' } }, custom: [] };

test('profile precedence and saved snapshots survive missing preferences and serialization', () => {
  expect(resolveClimateProfile(trip, segment, settings).name).toBe('My car');
  const scoped = { ...trip, climateProfiles: { car: { custom: { mode: 'bus' as const } } } };
  expect(resolveClimateProfile(scoped, segment, settings)).toEqual({ name: 'Car (trip default)', profile: { mode: 'bus' } });
  const custom = { ...segment, climateProfile: { mode: 'ferry' as const, withVehicle: true } };
  expect(resolveClimateProfile(scoped, custom, settings).profile.mode).toBe('ferry');
  expect(resolveClimateProfile(scoped, custom, settings, false).profile.mode).toBe('bus');
  const named = { ...trip, climateProfiles: { car: namedProfileChoice(profile) } };
  const parsed = JSON.parse(serializeTrip(named));
  expect(resolveClimateProfile(parsed, segment, { ...settings, profiles: [] }).profile).toEqual(profile.profile);
  expect(segmentClimate(parsed, segment, { ...settings, profiles: [] }).result?.co2eKg).toBeCloseTo(7.96782);
  expect(resolveClimateProfile(named, segment, { ...settings, profiles: [{ ...profile, name: 'Renamed', profile: { mode: 'none' } }] }).profile.mode).toBe('none');
});

test('built-in and custom modes map correctly and zero routes remain zero', () => {
  for (const mode of ['walk', 'bike', 'run', 'hike', 'other']) expect(builtInClimateProfile(mode)).toEqual({ mode: 'none' });
  expect(builtInClimateProfile('taxi').mode).toBe('car');
  expect(builtInClimateProfiles.map(p => p.name)).toEqual(['Car [built-in]', 'Bus [built-in]', 'Rail [built-in]', 'Flight [built-in]', 'Ferry [built-in]', 'No emission']);
  const builtInBus = { ...settings, builtIn: { car: { climateProfileId: 'builtin:bus' } } };
  expect(resolveClimateProfile(trip, segment, builtInBus)).toEqual({ name: 'Bus [built-in]', profile: { mode: 'bus' } });
  expect(resolveClimateProfile(trip, segment, { ...settings, builtIn: {} }).name).toBe('Car [built-in]');
  expect(builtInClimateProfile('subway')).toEqual({ mode: 'rail', traction: 'electric' });
  const other = { ...segment, transportMode: 'other' as const, customIcon: 'motorcycle' };
  const configured = { ...settings, custom: [{ icon: 'motorcycle', name: 'Motorbike', color: '', routingProfile: '', climateProfileId: 'own-car' }] };
  expect(resolveClimateProfile(trip, other, configured).profile).toEqual(profile.profile);
  expect(segmentClimate(trip, { ...segment, routingProfile: 'teleport' }, settings).result?.co2eKg).toBe(0);
  expect(segmentClimate(trip, { ...segment, distanceStats: { ...segment.distanceStats!, totalDistance: 0 } }, settings).result?.co2eKg).toBe(0);
});

test('route countries convert to ISO3 and always drive electric profiles, including legacy overrides', () => {
  const electric = { ...segment, countryDistances: { HU: 75, DE: 25 }, climateProfile: { mode: 'car' as const, fuelType: 'bev' as const } };
  expect(routeCountryShares(electric)).toEqual({ HUN: .75, DEU: .25 });
  const expected = calculate({ mode: 'car', fuelType: 'bev', date: '2026-06-01', distanceKm: 100, gridShares: { HUN: .75, DEU: .25 } });
  expect(segmentClimate(trip, electric, settings).result?.co2eKg).toBeCloseTo(expected.co2eKg);
  const override = { ...electric, climateProfile: { ...electric.climateProfile, gridShares: { FRA: 1 } } };
  expect(segmentClimate(trip, override, settings).result?.co2eKg).toBeCloseTo(expected.co2eKg);
  const rail = { ...electric, climateProfile: { mode: 'rail' as const, countryShares: { FRA: 1 } } };
  expect(segmentClimate(trip, rail, settings).result?.co2eKg).toBeCloseTo(calculate({ mode: 'rail', date: '2026-06-01', distanceKm: 100, countryShares: { HUN: .75, DEU: .25 } }).co2eKg);
  expect(routeCountryShares({ ...segment, countryDistances: { HU: 25, __unassigned__: 75 } })).toEqual({ HUN: .25, _WORLD: .75 });
  expect(calculate({ mode: 'car', fuelType: 'bev', date: '2026-06-01', distanceKm: 100, gridShares: { _WORLD: 1 } }).factorSets.grid?.level).toBe('world');
});

test('GPX flights use exact distances and explicit distance settings override automatic detection', () => {
  const flight = { ...segment, transportMode: 'flight' as const, source: 'gpx' as const };
  const clean = { ...settings, builtIn: {} };
  expect(segmentClimate(trip, flight, clean).result?.distanceKmUsed).toBe(100);
  expect(segmentClimate(trip, { ...flight, source: 'router' }, clean).result?.distanceKmUsed).toBe(108);
  expect(segmentClimate(trip, { ...flight, climateProfile: { mode: 'flight', geometry: 'great_circle' } }, clean).result?.distanceKmUsed).toBe(108);
});

test('live country-worker results replace world factors without writing caches into shared segments', () => {
  const train: Segment = { ...segment, transportMode: 'rail', countryDistances: undefined, climateProfile: undefined };
  const clean = { profiles: [], builtIn: {}, custom: [] };
  const before = JSON.stringify(train);
  const world = segmentClimate(trip, train, clean).result!;
  expect(world.factorSets.grid?.level).toBe('world');
  const result = segmentClimate(trip, train, clean, { HU: 75, DE: 25 }).result!;
  expect(result.factorSets.grid?.countries.map(factor => factor.country)).toEqual(['HUN', 'DEU']);
  expect(result.byCountry!.HUN.co2eKg + result.byCountry!.DEU.co2eKg).toBeCloseTo(result.co2eKg, 12);
  expect(result.co2eKg).not.toBeCloseTo(world.co2eKg, 6);
  expect(JSON.stringify(train)).toBe(before);
});

test('both electric rail types use the calculator benchmarks with cached route-country shares', () => {
  const results = (['inter_city', 'high_speed'] as const).map(railType => {
    const train: Segment = { ...segment, transportMode: 'rail', countryDistances: { HU: 75, DE: 25 }, climateProfile: { mode: 'rail', railType, traction: 'electric' } };
    const actual = segmentClimate(trip, train, settings).result!;
    const expected = calculate({ mode: 'rail', railType, traction: 'electric', date: '2026-06-01', distanceKm: 100, countryShares: { HUN: .75, DEU: .25 } });
    expect(actual).toEqual(expected);
    expect(actual.directKg).toBe(0);
    expect(actual.factorSets.railEnergy?.yearUsed).toBe(2017);
    return actual.co2eKg;
  });
  expect(results[0] / results[1]).toBeCloseTo(285 / 188, 12);
});

test('legacy unknown traction profiles resolve identically to diesel profiles', () => {
  const legacy: Segment = JSON.parse(JSON.stringify({ ...segment, climateProfile: { mode: 'rail', traction: 'unknown' } }));
  const diesel: Segment = { ...legacy, climateProfile: { mode: 'rail', traction: 'diesel' } };
  expect(segmentClimate(trip, legacy, settings)).toEqual(segmentClimate(trip, diesel, settings));
  expect(segmentClimate(trip, legacy, settings).result?.warnings[0].code).toBe('RAIL_DIESEL_APPROXIMATED');
});

test('invalid segments are isolated, totals sum valid estimates, and annual allocation is proportional', () => {
  const bad = { ...segment, id: 'bad', distanceStats: { ...segment.distanceStats!, totalDistance: -1 } };
  const result = tripClimate({ ...trip, segments: [segment, bad] }, settings);
  expect(result.totalKg).toBeCloseTo(7.96782);
  expect(result.unavailable).toBe(1);
  const dated = { ...trip, startDate: '2025-12-31', endDate: '2026-01-02' };
  const yearly = countryYearDistances([dated], emptyAnalyticsSelection, undefined, () => 90);
  expect(yearly).toEqual([{ year: 2025, distance: 30 }, { year: 2026, distance: 60 }]);
});
