import type { CountryPart, Segment, Trip } from '../../../shared/types';
import { copyEffectiveGeometryCache } from '../utils/effectiveGeometry';
import { countryPartStats, getSegmentGeometry, samePosition, sameSegmentGeometryIdentity } from '../utils/segmentGeometry';
import { segmentKey } from './types';
import type { CountryData } from './types';
import { getClimateSettings, withClimateCache } from '../climate/profiles';
import { compactClimateImpact } from '../climate/cache';

export const canPersistCountryParts = (trip: Trip) => !trip.metadata?.isSharedTripReference;

export function withSavedCountryParts(working: Trip, saved: Trip): Trip {
  // Compare save state against persisted geometry and climate caches, so new
  // background calculations remain saveable without creating undo entries.
  const originals = new Map(saved.segments.map(segment => [segment.id, segment]));
  const segments = working.segments.map(segment => {
    const original = originals.get(segment.id);
    if (!original) return segment;
    const climate = segment.climateImpact && compactClimateImpact(segment.climateImpact);
    const savedClimate = original.climateImpact && compactClimateImpact(original.climateImpact);
    if (JSON.stringify([segment.geometry, segment.countryParts, segment.countryDistances, climate]) === JSON.stringify([original.geometry, original.countryParts, original.countryDistances, savedClimate])) return segment;
    const content = { ...segment };
    for (const field of ['geometry', 'countryParts', 'countryDistances', 'climateImpact'] as const) {
      delete content[field];
      if (original[field] !== undefined) Object.assign(content, { [field]: original[field] });
    }
    return content;
  });
  const content = { ...working, segments };
  if (working.countryDataRevision !== saved.countryDataRevision) {
    delete content.countryDataRevision;
    if (saved.countryDataRevision) content.countryDataRevision = saved.countryDataRevision;
  }
  return content;
}

export function compactCountryData(trip: Trip): Trip {
  let changed = false;
  const segments = trip.segments.map(segment => {
    if (!('countryCache' in segment) && !('geometryVersion' in (segment.distanceStats || {}))) return segment;
    changed = true;
    const { countryCache, ...content } = segment as Segment & { countryCache?: { result?: { distanceKmByCountry?: Record<string, number> } } };
    content.countryDistances ||= countryCache?.result?.distanceKmByCountry;
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

export function tripForStorage(trip: Trip): Trip {
  const compact = compactCountryData(trip);
  return { ...compact, segments: compact.segments.map(segment => {
    if (!segment.countryParts) return segment;
    const content = { ...segment };
    if (segment.geometry) { delete content.countryParts; return content; }
    delete content.geometry;
    delete content.distanceStats;
    delete content.countryDistances;
    return content;
  }) };
}

export function attachCountryParts(trips: Trip[], parts: Record<string, CountryPart[]>, revisions: Record<string, string> = {}): Trip[] {
  const climateSettings = getClimateSettings();
  let changed = false;
  const next = trips.map(trip => {
    if (!canPersistCountryParts(trip)) return trip;
    let tripChanged = false;
    const segments = trip.segments.map(segment => {
      const split = parts[segmentKey(trip.id, segment.id)];
      if (!split || split === segment.countryParts) return segment;
      changed = tripChanged = true;
      const updated = { ...segment, countryParts: split };
      delete updated.geometry;
      delete updated.countryDistances;
      updated.distanceStats ||= countryPartStats(updated);
      copyEffectiveGeometryCache(segment, updated);
      return updated;
    });
    const revision = revisions[trip.id];
    if (revision && trip.countryDataRevision !== revision) changed = tripChanged = true;
    return tripChanged ? withClimateCache({ ...trip, segments, ...(revision ? { countryDataRevision: revision } : {}) }, climateSettings) : trip;
  });
  return changed ? next : trips;
}

export function sameCountryInputs(a: Segment, b: Segment): boolean {
  if (a === b) return true;
  const sameGeometry = sameSegmentGeometryIdentity(a, b) ||
    (!!a.countryParts && a.countryParts === b.countryParts && !a.geometry && !b.geometry) || (() => {
    const left = getSegmentGeometry(a), right = getSegmentGeometry(b);
    return left === right || !!left && !!right && left.coordinates.length === right.coordinates.length && left.coordinates.every((coordinate, i) => samePosition(coordinate, right.coordinates[i]));
  })();
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
    if (!other || trip.countryDataRevision !== other.countryDataRevision || canPersistCountryParts(trip) !== canPersistCountryParts(other) || trip.segments.length !== other.segments.length) return false;
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
  return Object.keys(results).length === Object.keys(data.results).length ? data : { ...data, results };
}
