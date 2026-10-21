import { test, expect } from '@playwright/test';
import type { Segment, Trip } from '../../shared/types';
import { CountryPartitioner } from '../src/countries/partition';
import type { CountryAsset } from '../src/countries/types';
import { attachCountryParts, sameCountryInputs, sameCountryTripInputs } from '../src/countries/cache';
import { countryDistances, resultFromParts } from '../src/countries/parts';
import { computeTripCaches } from '../src/utils/distance';
import { getEffectiveGeometry, geometryDistance } from '../src/utils/effectiveGeometry';
import { comparisonGeometry, getSegmentGeometry } from '../src/utils/segmentGeometry';
import { serializeTrip } from '../src/utils/serializeTrip';
import { exportTripGPX, exportTripGeoJSON } from '../src/utils/exportUtils';

const rectangle = (code: string, west: number, east: number): CountryAsset => {
  const geometry: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[west, -2], [east, -2], [east, 2], [west, 2], [west, -2]]] };
  return { code, land: geometry, territorial: geometry };
};
const assets = [rectangle('AA', -2, 0), rectangle('BB', 0, 2)];
const segment = (coordinates: number[][], extra: Partial<Segment> = {}): Segment => ({ id: 'route', transportMode: 'hike', routingProfile: 'straight', source: 'manual', routingService: 'manual', geometry: { type: 'LineString', coordinates }, waypoints: [{ id: 'start', coordinates: coordinates[0] as [number, number] }, { id: 'end', coordinates: coordinates.at(-1)! as [number, number] }], ...extra });
const split = (source: Segment, boundaries = assets, tolerance = 10): Segment => {
  const steps = new CountryPartitioner(boundaries, tolerance).splitSegmentSteps(source);
  let step = steps.next(); while (!step.done) step = steps.next();
  const result = { ...source, countryParts: step.value }; delete result.geometry;
  return result;
};

test('shallow A B A excursions merge by depth while keeping every route coordinate and total', () => {
  const source = segment([[-0.001, 0], [0.00005, 0.001], [0.00005, 0.01], [-0.001, 0.011], [0.00004, 0.012], [-0.001, 0.013]]);
  expect(split(source, assets, 0).countryParts).toHaveLength(5);
  const merged = split(source);
  expect(merged.countryParts!.map(part => part.country)).toEqual(['AA']);
  const coordinates = getSegmentGeometry(merged)!.coordinates;
  expect(coordinates).toEqual(source.geometry!.coordinates);
  for (const coordinate of source.geometry!.coordinates) expect(coordinates).toContainEqual(coordinate);
  expect(Object.values(countryDistances(merged)).reduce((sum, km) => sum + km, 0)).toBeCloseTo(geometryDistance(getEffectiveGeometry(source)), 10);
});

test('deep excursions and genuine one-way crossings remain split', () => {
  expect(split(segment([[-0.001, 0], [0.00012, 0.001], [-0.001, 0.002]])).countryParts!.map(part => part.country)).toEqual(['AA', 'BB', 'AA']);
  expect(split(segment([[-0.001, 0], [0.00005, 0.001]])).countryParts!.map(part => part.country)).toEqual(['AA', 'BB']);
  expect(split(segment([[-0.001, 0], [0.001, 0]]), [rectangle('AA', -2, -0.00002), rectangle('AA', 0.00002, 2)]).countryParts!.map(part => part.country)).toEqual(['AA', '__unassigned__', 'AA']);
});

test('the interior of a sparse edge must also stay within ten metres', () => {
  const polygon = (code: string, coordinates: number[][]): CountryAsset => ({ code, land: { type: 'Polygon', coordinates: [coordinates] }, territorial: { type: 'Polygon', coordinates: [coordinates] } });
  const a = polygon('AA', [[-2, -2], [0, -2], [0, -0.0004], [-0.001, -0.0004], [-0.001, 0.0004], [0, 0.0004], [0, 2], [-2, 2], [-2, -2]]);
  const b = polygon('BB', [[0, -2], [2, -2], [2, 2], [0, 2], [0, 0.0004], [-0.001, 0.0004], [-0.001, -0.0004], [0, -0.0004], [0, -2]]);
  const source = segment([[-0.00005, -0.001], [0.00005, -0.0007], [0.00005, 0.0007], [-0.00005, 0.001]]);
  expect(split(source, [a, b]).countryParts!.map(part => part.country)).toEqual(['AA', 'BB', 'AA']);
});

test('country-part files retain GPX tails, editor measurements, exports, and country cropping', () => {
  const original = computeTripCaches({ id: 'trip', name: 'GPX', createdAt: '', updatedAt: '', segments: [segment([[-2, 0, 0], [-1, 0, 10], [1, 0, 30], [2, 0, 40]], {
    source: 'gpx', routingService: 'gpx', waypoints: [{ id: 'a', coordinates: [-0.5, 0] }, { id: 'b', coordinates: [0.5, 0] }],
  })] });
  const converted = attachCountryParts([original], { '["trip","route"]': split(original.segments[0]).countryParts! }, { trip: 'revision' })[0];
  expect(sameCountryInputs(original.segments[0], converted.segments[0])).toBe(true);
  expect(sameCountryInputs(original.segments[0], { ...converted.segments[0], transportMode: 'flight' })).toBe(false);
  expect(sameCountryTripInputs([converted], [{ ...converted, countryDataRevision: 'new' }])).toBe(false);
  const text = serializeTrip(converted);
  const saved: Trip = JSON.parse(text);
  expect(saved.segments[0]).not.toHaveProperty('geometry');
  expect(saved.segments[0]).not.toHaveProperty('distanceStats');
  expect(saved.segments[0]).not.toHaveProperty('countryDistances');
  saved.segments[0].waypointDistances!.forEach((stats, i) => {
    const source = original.segments[0].waypointDistances![i];
    expect(Math.abs(stats.distanceKm - source.distanceKm)).toBeLessThanOrEqual(.0000051);
    expect(Math.abs(stats.elevationUp - source.elevationUp)).toBeLessThanOrEqual(.0051);
    expect(Math.abs(stats.elevationDown - source.elevationDown)).toBeLessThanOrEqual(.0051);
  });
  const restored = computeTripCaches(saved);
  expect(restored.segments[0].waypointDistances).toEqual(saved.segments[0].waypointDistances);
  expect(restored.segments[0].distanceStats!.totalDistance).toBeCloseTo(original.segments[0].distanceStats!.totalDistance, 4);
  expect(getSegmentGeometry(restored.segments[0])!.coordinates[0]).toEqual([-2, 0, 0]);
  expect(getSegmentGeometry(restored.segments[0])!.coordinates.at(-1)).toEqual([2, 0, 40]);
  const country = resultFromParts(restored.segments[0]);
  expect(country.pieces.map(piece => piece.country)).toEqual(['AA', 'BB']);
  expect(country.pieces[0].coordinates[0][0]).toBeCloseTo(-0.5, 8);
  expect(country.pieces.at(-1)!.coordinates.at(-1)![0]).toBeCloseTo(0.5, 8);
  expect(exportTripGPX(restored)).toContain('lon="-2"');
  expect(JSON.parse(exportTripGeoJSON(restored)).features.find((feature: GeoJSON.Feature) => feature.geometry.type === 'LineString').geometry.coordinates.at(-1)).toEqual([2, 0, 40]);
});

test('zero-distance coordinates and excluded teleport routes remain recoverable', () => {
  const coordinates = [[-1, 0], [-1, 0], [1, 0]];
  const converted = split(segment(coordinates, { routingProfile: 'teleport' }));
  expect(getSegmentGeometry(converted)!.coordinates).toEqual(coordinates);
  expect(countryDistances(converted)).toEqual({});
  expect(resultFromParts(converted).pieces).toEqual([]);
  expect(getSegmentGeometry(split(segment([[-1, 0], [-1, 0]])))!.coordinates).toEqual([[-1, 0], [-1, 0]]);
});

test('unfinished waypoints stay Unassigned without interrupting route attribution', () => {
  const source = segment([[-1, 0], [1, 0]]);
  source.waypoints.splice(1, 0, { id: 'unfinished', coordinates: [] as unknown as [number, number] });
  const result = resultFromParts(split(source));
  expect(result.waypointCountries).toEqual({ start: 'AA', unfinished: '__unassigned__', end: 'BB' });
  expect(result.distanceKmByCountry.AA).toBeGreaterThan(0);
  expect(result.distanceKmByCountry.BB).toBeGreaterThan(0);
  expect(result.totalDistanceKm).toBeCloseTo(geometryDistance(getEffectiveGeometry(source)), 10);
});

test('dateline and flight parts preserve source geometry and render without connecting across the world', () => {
  for (const transportMode of ['hike', 'flight'] as const) {
    const source = segment([[179, 60, 100], [-179, 60, 200]], { transportMode, source: 'gpx', routingService: 'gpx' });
    const restored: Segment = JSON.parse(JSON.stringify(split(source, [])));
    expect(getSegmentGeometry(restored)!.coordinates[0]).toEqual(source.geometry!.coordinates[0]);
    expect(getSegmentGeometry(restored)!.coordinates.at(-1)).toEqual(source.geometry!.coordinates.at(-1));
    expect(comparisonGeometry(getSegmentGeometry(restored))).toEqual(comparisonGeometry(source.geometry));
    for (const piece of resultFromParts(restored).pieces) for (let i = 1; i < piece.coordinates.length; i++) expect(Math.abs(piece.coordinates[i][0] - piece.coordinates[i - 1][0])).toBeLessThanOrEqual(180);
    expect(Object.values(countryDistances(restored)).reduce((sum, km) => sum + km, 0)).toBeCloseTo(geometryDistance(getEffectiveGeometry(source)), 10);
  }
  expect(comparisonGeometry({ type: 'LineString', coordinates: [[-1, 0], [0.5, 0], [-1, 0]] })).not.toEqual(comparisonGeometry({ type: 'LineString', coordinates: [[-1, 0], [1, 0], [-1, 0]] }));
});
