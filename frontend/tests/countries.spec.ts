import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { booleanPointInPolygon, point } from '@turf/turf';
import { CountryPartitioner } from '../src/countries/partition';
import { getEffectiveGeometry, geometryDistance } from '../src/utils/effectiveGeometry';
import { computeTripCaches } from '../src/utils/distance';
import { countryYearDistances, emptyAnalyticsSelection, tripFraction, tripIntersects } from '../src/countries/analytics';
import { UNASSIGNED, segmentKey } from '../src/countries/types';
import type { CountryAsset, CountryData } from '../src/countries/types';
import type { Segment, Trip } from '../../shared/types';

const rectangle = (code: string, west: number, east: number): CountryAsset => {
  const geometry: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[west, -2], [east, -2], [east, 2], [west, 2], [west, -2]]] };
  return { code, land: geometry, territorial: geometry };
};
const segment = (coordinates: number[][], properties: Partial<Segment> = {}): Segment => ({ id: 'route', name: 'Border trip', transportMode: 'car', routingProfile: 'car', routingService: 'manual', source: 'manual', geometry: { type: 'LineString', coordinates }, waypoints: coordinates.map((coordinates, i) => ({ id: `w${i}`, coordinates: coordinates.slice(0, 2) as [number, number] })), ...properties });
const trip = (segments: Segment[], properties: Partial<Trip> = {}): Trip => computeTripCaches({ id: 'trip', name: 'Journey', segments, startDate: '2024-12-31', endDate: '2025-01-02', createdAt: '', updatedAt: '', ...properties });
const partition = (s: Segment, assets = [rectangle('AA', -2, 0), rectangle('BB', 0, 2)]) => new CountryPartitioner(assets).partition(s, getEffectiveGeometry(s));

test('crossing without a border vertex conserves distance and derived shares', () => {
  const result = partition(segment([[-1, 0], [1, 0]]));
  expect(result.pieces.map(p => p.country)).toEqual(['AA', 'BB']);
  expect(result.shares.AA).toBeCloseTo(0.5, 9);
  expect(result.shares.BB).toBeCloseTo(0.5, 9);
  expect(Object.values(result.distanceKmByCountry).reduce((a, b) => a + b, 0)).toBeCloseTo(result.totalDistanceKm, 9);
  expect(result.pieces[0].coordinates.at(-1)).toEqual([0, 0]);
});

test('re-entry and out-and-back travel retain disconnected pieces and both traversals', () => {
  const once = partition(segment([[-1, 0], [1, 0]]));
  const twice = partition(segment([[-1, 0], [1, 0], [-1, 0]]));
  expect(twice.totalDistanceKm).toBeCloseTo(2 * once.totalDistanceKm, 9);
  expect(twice.distanceKmByCountry.AA).toBeCloseTo(2 * once.distanceKmByCountry.AA, 9);
  expect(twice.pieces.filter(p => p.country === 'AA')).toHaveLength(2);
});

test('holes and short enclaves are crossed even on a long sparse edge', () => {
  const parent = rectangle('AA', -2, 2);
  const hole = rectangle('BB', -0.001, 0.001);
  (parent.territorial as GeoJSON.Polygon).coordinates.push((hole.territorial as GeoJSON.Polygon).coordinates[0]);
  const result = partition(segment([[-1, 0], [1, 0]]), [parent, hole]);
  expect(result.pieces.map(p => p.country)).toEqual(['AA', 'BB', 'AA']);
  expect(result.shares.BB).toBeCloseTo(0.001, 8);
});

test('overlaps, shared-border travel and uncovered waters stay Unassigned', () => {
  expect(partition(segment([[0, -1], [0, 1]])).shares[UNASSIGNED]).toBe(1);
  expect(partition(segment([[3, 0], [4, 0]])).shares[UNASSIGNED]).toBe(1);
  expect(partition(segment([[-0.5, 0], [0.5, 0]]), [rectangle('AA', -2, 2), rectangle('BB', -1, 1)]).shares[UNASSIGNED]).toBe(1);
});

test('flights bypass attribution; teleport and zero distances do not contribute', () => {
  const flight = partition(segment([[-1, 0], [1, 0]], { transportMode: 'flight' }));
  expect(Object.keys(flight.distanceKmByCountry)).toEqual([UNASSIGNED]);
  expect(flight.shares[UNASSIGNED]).toBeCloseTo(1, 9);
  const teleport = partition(segment([[-1, 0], [1, 0]], { routingProfile: 'teleport' }));
  expect(teleport.totalDistanceKm).toBe(0);
  expect(teleport.pieces).toEqual([]);
  expect(partition(segment([[0, 0], [0, 0]])).shares).toEqual({});
});

test('GPX effective geometry trims endpoints and retains a closed-loop traversal', () => {
  const s = segment([[-2, 0, 0], [-1, 0, 10], [0, 0, 20], [1, 0, 10], [2, 0, 0]], { routingService: 'gpx', waypoints: [{ id: 'a', coordinates: [-0.5, 0] }, { id: 'b', coordinates: [0.5, 0] }] });
  const effective = getEffectiveGeometry(s);
  expect(effective.coordinates[0][0][0]).toBeCloseTo(-0.5, 5);
  expect(effective.coordinates[0].at(-1)![0]).toBeCloseTo(0.5, 5);
  expect(trip([s]).segments[0].distanceStats!.totalDistance).toBeCloseTo(partition(s).totalDistanceKm, 9);
  const loop = segment([[-1, 0], [1, 0], [-1, 0]], { routingService: 'gpx', waypoints: [{ id: 'start', coordinates: [-1, 0] }, { id: 'end', coordinates: [-1, 0] }] });
  expect(geometryDistance(getEffectiveGeometry(loop))).toBeGreaterThan(400);
});

test('antimeridian flights and routes have no artificial world-spanning edges', () => {
  for (const transportMode of ['car', 'flight'] as const) {
    const s = segment([[179, 10], [-179, 10]], { transportMode });
    const geometry = getEffectiveGeometry(s);
    expect(geometry.coordinates.length).toBeGreaterThan(1);
    for (const line of geometry.coordinates) for (let i = 1; i < line.length; i++) expect(Math.abs(line[i][0] - line[i - 1][0])).toBeLessThanOrEqual(180);
    expect(partition(s).totalDistanceKm).toBeLessThan(250);
  }
});

test('country/mode yearly totals retain inclusive trip-day allocation and date overlap', () => {
  const t = trip([segment([[-1, 0], [1, 0]])]);
  const data: CountryData = { index: { version: 'test', countries: [], attribution: '' }, results: { [segmentKey(t.id, 'route')]: partition(t.segments[0]) } };
  const selection = { ...emptyAnalyticsSelection, countries: true, country: 'AA', mode: 'car' };
  const years = countryYearDistances([t], selection, data);
  expect(years.map(y => y.year)).toEqual([2024, 2025]);
  expect(years[1].distance).toBeCloseTo(2 * years[0].distance, 9);
  expect(years.reduce((sum, y) => sum + y.distance, 0)).toBeCloseTo(data.results[segmentKey(t.id, 'route')].distanceKmByCountry.AA, 9);
  expect(tripFraction(t, [new Date(2025, 0, 1).getTime(), new Date(2025, 0, 1).getTime()])).toBeCloseTo(1 / 3, 9);
  expect(tripIntersects(t, [new Date(2025, 0, 2).getTime(), new Date(2025, 0, 2).getTime()])).toBe(true);
  expect(tripIntersects(t, [new Date(2025, 0, 3).getTime(), new Date(2025, 0, 4).getTime()])).toBe(false);
  expect(tripIntersects({ ...t, startDate: undefined, endDate: undefined }, [0, 1])).toBe(true);
});

test('installed Overture boundaries attribute an Austria–Germany crossing and preserve territories', () => {
  const asset = (code: string): CountryAsset => JSON.parse(gunzipSync(readFileSync(new URL(`../public/countries/${code}.json.gz.bin`, import.meta.url))).toString());
  const crossing = partition(segment([[11.4, 47.26], [11.58, 48.14]]), [asset('AT'), asset('DE')]);
  expect(crossing.distanceKmByCountry.AT).toBeGreaterThan(0);
  expect(crossing.distanceKmByCountry.DE).toBeGreaterThan(0);
  expect(crossing.distanceKmByCountry[UNASSIGNED] || 0).toBeLessThan(0.01);
  expect(Object.values(crossing.distanceKmByCountry).reduce((sum, km) => sum + km, 0)).toBeCloseTo(crossing.totalDistanceKm, 9);
  for (const [code, coordinate] of [['GL', [-51.7216, 64.1835]], ['RE', [55.4481, -20.8789]], ['FK', [-57.8517, -51.6977]], ['GE', [44.8, 41.7]]] as const) {
    const country = asset(code);
    expect(country.code).toBe(code);
    expect(booleanPointInPolygon(point([...coordinate]), country.territorial)).toBe(true);
  }
});
