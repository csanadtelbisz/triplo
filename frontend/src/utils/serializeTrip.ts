import type { Segment, SegmentDistanceStats, SharedTripReference, Trip } from '../../../shared/types';
import { tripForStorage } from '../countries/cache';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));
const distances = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([key, km]) => [key, round(km, 5)]));
const statsForStorage = (stats: SegmentDistanceStats | NonNullable<Segment['waypointDistances']>[number]) => ({
  ...stats,
  ...('totalDistance' in stats ? { totalDistance: round(stats.totalDistance, 5) } : { distanceKm: round(stats.distanceKm, 5) }),
  elevationUp: stats.hasElevation ? round(stats.elevationUp, 2) : undefined,
  elevationDown: stats.hasElevation ? round(stats.elevationDown, 2) : undefined,
});

export function serializeTrip(trip: Trip | SharedTripReference, pretty = true): string {
  const stored = 'segments' in trip ? tripForStorage(trip) : trip;
  const content = 'segments' in stored ? {
    ...stored,
    ...(stored.tripDistanceSummary && { tripDistanceSummary: {
      ...stored.tripDistanceSummary,
      totalDistance: round(stored.tripDistanceSummary.totalDistance, 5),
      distanceByMode: distances(stored.tripDistanceSummary.distanceByMode),
    } }),
    segments: stored.segments.map(segment => ({
      ...segment,
      waypoints: segment.waypoints.map(waypoint => ({ ...waypoint, coordinates: waypoint.coordinates.map(value => round(value, 7)) })),
      ...(segment.distanceStats && { distanceStats: statsForStorage(segment.distanceStats) }),
      ...(segment.waypointDistances && { waypointDistances: segment.waypointDistances.map(statsForStorage) }),
      ...(segment.countryDistances && { countryDistances: distances(segment.countryDistances) }),
      ...(segment.countryParts && { countryParts: segment.countryParts.map(part => ({ ...part, distanceStats: statsForStorage(part.distanceStats) })) }),
    })),
  } : stored;
  const serialized = JSON.stringify(content);
  if (!pretty) return serialized;
  const value: JsonValue = JSON.parse(serialized);
  function format(value: JsonValue, depth: number, key = ''): string {
    if (value === null || typeof value !== 'object' || key === 'geometry' || key === 'coordinates' ||
      (!Array.isArray(value) && typeof value.hasElevation === 'boolean' && ('totalDistance' in value || 'distanceKm' in value))) return JSON.stringify(value);
    const array = Array.isArray(value);
    const entries = array
      ? value.map(item => format(item, depth + 1))
      : Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${format(item, depth + 1, key)}`);
    const [open, close] = array ? ['[', ']'] : ['{', '}'];
    if (!entries.length) return open + close;
    const padding = '  '.repeat(depth + 1);
    return `${open}\n${entries.map(entry => padding + entry).join(',\n')}\n${'  '.repeat(depth)}${close}`;
  }
  return format(value, 0);
}
