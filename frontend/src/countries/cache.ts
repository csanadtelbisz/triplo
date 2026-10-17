import type { Segment, Trip } from '../../../shared/types';
import { copyEffectiveGeometryCache } from '../utils/effectiveGeometry';
import { segmentKey } from './types';
import type { CountryData, CountryResult } from './types';

export const canPersistCountryDistances = (trip: Trip) => !trip.metadata?.isSharedTripReference;

export function withSavedCountryDistances(working: Trip, saved: Trip): Trip {
  const originals = new Map(saved.segments.map(segment => [segment.id, segment.countryDistances]));
  let changed = false;
  const segments = working.segments.map(segment => {
    const countryDistances = originals.get(segment.id);
    if (sameCountryDistances(segment.countryDistances, countryDistances)) return segment;
    changed = true;
    const content = { ...segment };
    delete content.countryDistances;
    return countryDistances ? { ...content, countryDistances } : content;
  });
  return changed ? { ...working, segments } : working;
}

export function validCountryDistances(value: unknown): value is Record<string, number> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(distance => typeof distance === 'number' && Number.isFinite(distance) && distance >= 0);
}

function sameCountryDistances(a: Record<string, number> | undefined, b: Record<string, number> | undefined) {
  return a === b || !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([code, distance]) => b[code] === distance);
}

export function countrySummary(distances: Record<string, number>): CountryResult {
  const totalDistanceKm = Object.values(distances).reduce((sum, distance) => sum + distance, 0);
  return { distanceKmByCountry: distances, totalDistanceKm, shares: Object.fromEntries(Object.entries(distances).map(([code, distance]) => [code, totalDistanceKm ? distance / totalDistanceKm : 0])), pieces: [], waypointCountries: {}, geometryReady: false };
}

export function compactCountryData(trip: Trip): Trip {
  let changed = false;
  const segments = trip.segments.map(segment => {
    if (!('countryCache' in segment) && !('geometryVersion' in (segment.distanceStats || {}))) return segment;
    changed = true;
    const { countryCache, ...content } = segment as Segment & { countryCache?: { result?: { distanceKmByCountry?: unknown } } };
    const distances = content.countryDistances ?? countryCache?.result?.distanceKmByCountry;
    if (validCountryDistances(distances)) content.countryDistances = distances;
    if (content.distanceStats && 'geometryVersion' in content.distanceStats) {
      const stats = { ...content.distanceStats };
      delete stats.geometryVersion;
      content.distanceStats = stats;
    }
    copyEffectiveGeometryCache(segment, content);
    return content;
  });
  return changed ? { ...trip, segments } : trip;
}

export function attachCountryDistances(trips: Trip[], distances: Record<string, Record<string, number>>): Trip[] {
  if (!Object.keys(distances).length) return trips;
  let changed = false;
  const next = trips.map(trip => {
    if (!canPersistCountryDistances(trip)) return trip;
    let tripChanged = false;
    const segments = trip.segments.map(segment => {
      const mapping = distances[segmentKey(trip.id, segment.id)];
      if (!mapping || sameCountryDistances(segment.countryDistances, mapping)) return segment;
      changed = tripChanged = true;
      const updated = { ...segment, countryDistances: mapping };
      copyEffectiveGeometryCache(segment, updated);
      return updated;
    });
    return tripChanged ? { ...trip, segments } : trip;
  });
  return changed ? next : trips;
}

export function sameCountryInputs(a: Segment, b: Segment): boolean {
  if (a === b) return true;
  const sameGeometry = a.geometry === b.geometry || (a.geometry?.type === b.geometry?.type &&
    !!a.geometry?.coordinates && !!b.geometry?.coordinates && a.geometry.coordinates.length === b.geometry.coordinates.length &&
    a.geometry.coordinates.every((coordinate, i) => coordinate.length === b.geometry.coordinates[i].length && coordinate.every((value, axis) => value === b.geometry.coordinates[i][axis])));
  return a.transportMode === b.transportMode && a.routingProfile === b.routingProfile && sameGeometry &&
    a.routingService === b.routingService && a.waypoints.length === b.waypoints.length &&
    a.waypoints.every((waypoint, i) => waypoint.id === b.waypoints[i].id && waypoint.coordinates.length === b.waypoints[i].coordinates.length && waypoint.coordinates.every((value, axis) => value === b.waypoints[i].coordinates[axis]));
}

export function sameCountryTripInputs(a: Trip[], b: Trip[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const byId = new Map(b.map(trip => [trip.id, trip]));
  return a.every(trip => {
    const other = byId.get(trip.id);
    if (trip === other) return true;
    if (!other || canPersistCountryDistances(trip) !== canPersistCountryDistances(other) || trip.segments.length !== other.segments.length) return false;
    const segments = new Map(other.segments.map(segment => [segment.id, segment]));
    return trip.segments.every(segment => {
      const target = segments.get(segment.id);
      return !!target && sameCountryInputs(segment, target);
    });
  });
}

export function retainCountryData(data: CountryData | undefined, source: Trip[], target: Trip[]): CountryData | undefined {
  if (!data || source === target) return data;
  const originals = new Map(source.flatMap(trip => trip.segments.map(segment => [segmentKey(trip.id, segment.id), segment] as const)));
  const results: CountryData['results'] = {};
  for (const trip of target) for (const segment of trip.segments) {
    const key = segmentKey(trip.id, segment.id), previous = originals.get(key);
    if (data.results[key] && previous && sameCountryInputs(previous, segment)) results[key] = data.results[key];
  }
  return Object.keys(results).length === Object.keys(data.results).length ? data : { index: data.index, results };
}
