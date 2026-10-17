import type { Segment, SegmentCountryCache, Trip } from '../../../shared/types';
import { copyEffectiveGeometryCache, GEOMETRY_VERSION } from '../utils/effectiveGeometry';
import { COUNTRY_ALGORITHM_VERSION, segmentKey } from './types';
import type { CountryData, CountryIndex } from './types';

export const canPersistCountryCache = (trip: Trip) => !trip.metadata?.isSharedTripReference;

export function withSavedCountryCaches(working: Trip, saved: Trip): Trip {
  const originals = new Map(saved.segments.map(segment => [segment.id, segment.countryCache]));
  let changed = false;
  const segments = working.segments.map(segment => {
    const countryCache = originals.get(segment.id);
    if (segment.countryCache === countryCache || (countryCache &&
      validCountryCache(countryCache, countryCache.boundaryVersion, countryCache.inputHash) &&
      validCountryCache(segment.countryCache, countryCache.boundaryVersion, countryCache.inputHash))) return segment;
    changed = true;
    const { countryCache: _cache, ...content } = segment;
    return countryCache ? { ...content, countryCache } : content;
  });
  return changed ? { ...working, segments } : working;
}

export function validCountryCache(cache: SegmentCountryCache | undefined, boundaryVersion: string, hash: string): cache is SegmentCountryCache {
  return !!cache && cache.boundaryVersion === boundaryVersion &&
    cache.algorithmVersion === COUNTRY_ALGORITHM_VERSION && cache.geometryVersion === GEOMETRY_VERSION &&
    cache.inputHash === hash && !!cache.result && Number.isFinite(cache.result.totalDistanceKm) &&
    Array.isArray(cache.result.pieces) && !!cache.result.distanceKmByCountry &&
    !!cache.result.shares && !!cache.result.waypointCountries;
}

export function attachCountryCaches(trips: Trip[], caches: Record<string, SegmentCountryCache>): Trip[] {
  if (!Object.keys(caches).length) return trips;
  let changed = false;
  const next = trips.map(trip => {
    if (!canPersistCountryCache(trip)) return trip;
    let tripChanged = false;
    const segments = trip.segments.map(segment => {
      const cache = caches[segmentKey(trip.id, segment.id)];
      if (!cache || validCountryCache(segment.countryCache, cache.boundaryVersion, cache.inputHash)) return segment;
      changed = tripChanged = true;
      const updated = { ...segment, countryCache: cache };
      copyEffectiveGeometryCache(segment, updated);
      return updated;
    });
    return tripChanged ? { ...trip, segments } : trip;
  });
  return changed ? next : trips;
}

export function countryCacheFor(index: CountryIndex, inputHash: string, result: SegmentCountryCache['result']): SegmentCountryCache {
  return { boundaryVersion: index.version, algorithmVersion: COUNTRY_ALGORITHM_VERSION, geometryVersion: GEOMETRY_VERSION, inputHash, result };
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
    if (!other || canPersistCountryCache(trip) !== canPersistCountryCache(other) || trip.segments.length !== other.segments.length) return false;
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
