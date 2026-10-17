import type { Segment, SegmentCountryCache, Trip } from '../../../shared/types';
import { copyEffectiveGeometryCache, GEOMETRY_VERSION } from '../utils/effectiveGeometry';
import { COUNTRY_ALGORITHM_VERSION, segmentKey } from './types';
import type { CountryIndex } from './types';

export const canPersistCountryCache = (trip: Trip) => !trip.metadata?.isSharedTripReference && !trip.metadata?.sharedService;

export function validCountryCache(cache: SegmentCountryCache | undefined, boundaryVersion: string, hash: string): cache is SegmentCountryCache {
  return !!cache && cache.boundaryVersion === boundaryVersion &&
    cache.algorithmVersion === COUNTRY_ALGORITHM_VERSION && cache.geometryVersion === GEOMETRY_VERSION &&
    cache.inputHash === hash && !!cache.result && Number.isFinite(cache.result.totalDistanceKm) &&
    Array.isArray(cache.result.pieces) && !!cache.result.distanceKmByCountry &&
    !!cache.result.shares && !!cache.result.waypointCountries;
}

export function attachCountryCaches(trips: Trip[], caches: Record<string, SegmentCountryCache>): Trip[] {
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
  return a.transportMode === b.transportMode && a.routingProfile === b.routingProfile && a.geometry === b.geometry &&
    a.routingService === b.routingService && a.waypoints.length === b.waypoints.length &&
    a.waypoints.every((waypoint, i) => waypoint.id === b.waypoints[i].id && waypoint.coordinates.every((value, axis) => value === b.waypoints[i].coordinates[axis]));
}

export function sameCountryTripInputs(a: Trip[], b: Trip[]): boolean {
  return a.length === b.length && a.every((trip, i) => trip.id === b[i].id &&
    canPersistCountryCache(trip) === canPersistCountryCache(b[i]) && trip.segments.length === b[i].segments.length &&
    trip.segments.every((segment, j) => segment.id === b[i].segments[j].id && sameCountryInputs(segment, b[i].segments[j])));
}
