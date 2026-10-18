import { lineString, nearestPointOnLine } from '@turf/turf';
import type { CountryPart, Segment, SegmentDistanceStats } from '../../../shared/types';
import { activeCountryGeometries, geometryDistance, getEffectiveGeometry } from '../utils/effectiveGeometry';
import type { RouteGeometry } from '../utils/effectiveGeometry';
import { UNASSIGNED } from './types';
import type { CountryPiece, CountryResult } from './types';

export const emptyStats = (): SegmentDistanceStats => ({ totalDistance: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 });

export function geometryStats(geometry: RouteGeometry): SegmentDistanceStats {
  const stats = { ...emptyStats(), totalDistance: geometryDistance(geometry) };
  for (const line of geometry.coordinates) for (let i = 1; i < line.length; i++) {
    if (line[i - 1].length > 2 && line[i].length > 2) {
      stats.hasElevation = true;
      const difference = line[i][2] - line[i - 1][2];
      stats.elevationUp += Math.max(0, difference);
      stats.elevationDown += Math.max(0, -difference);
    }
  }
  return stats;
}

export function countryDistances(segment: Segment): Record<string, number> {
  if (!segment.countryParts) return segment.countryDistances || {};
  const distances: Record<string, number> = {};
  for (const part of segment.countryParts) if (part.distanceStats.totalDistance > 0) distances[part.country] = (distances[part.country] || 0) + part.distanceStats.totalDistance;
  return distances;
}

export function makeCountryParts(segment: Segment, pieces: CountryPiece[]): CountryPart[] {
  const parts = pieces.map(piece => ({ country: piece.country, geometry: { type: 'LineString' as const, coordinates: piece.coordinates }, distanceStats: emptyStats() }));
  const split = { ...segment, geometry: undefined, countryParts: parts };
  if (segment.routingProfile === 'teleport') return parts;
  const active = segment.transportMode === 'flight'
    ? parts.map((part, partIndex) => ({ partIndex, coordinates: part.geometry.coordinates })) : activeCountryGeometries(split);
  for (const { partIndex, coordinates } of active) {
    const stats = geometryStats({ type: 'MultiLineString', coordinates: [coordinates] });
    const target = parts[partIndex].distanceStats;
    target.totalDistance += stats.totalDistance;
    target.hasElevation ||= stats.hasElevation;
    target.elevationUp += stats.elevationUp;
    target.elevationDown += stats.elevationDown;
  }
  const original = geometryStats(getEffectiveGeometry(segment));
  if (!original.hasElevation) for (const part of parts) part.distanceStats.hasElevation = false;
  for (const field of ['totalDistance', 'elevationUp', 'elevationDown'] as const) {
    const sum = parts.reduce((sum, part) => sum + part.distanceStats[field], 0);
    if (sum) for (const part of parts) part.distanceStats[field] *= original[field] / sum;
  }
  return parts;
}

const results = new WeakMap<Segment, CountryResult>();
export function resultFromParts(segment: Segment): CountryResult {
  const cached = results.get(segment);
  if (cached) return cached;
  const distanceKmByCountry = countryDistances(segment);
  const totalDistanceKm = Object.values(distanceKmByCountry).reduce((sum, distance) => sum + distance, 0);
  const active = segment.routingProfile === 'teleport' ? [] : segment.transportMode === 'flight'
    ? getEffectiveGeometry(segment).coordinates.map(coordinates => ({ partIndex: 0, coordinates })) : activeCountryGeometries(segment);
  const lengths = active.map(({ coordinates }) => geometryDistance({ type: 'MultiLineString', coordinates: [coordinates] }));
  const totals = new Map<number, number>();
  active.forEach(({ partIndex }, i) => totals.set(partIndex, (totals.get(partIndex) || 0) + lengths[i]));
  const pieces = active.map(({ partIndex, coordinates }, i) => ({
    country: segment.countryParts![partIndex].country, coordinates,
    distanceKm: totals.get(partIndex) ? (segment.transportMode === 'flight' ? totalDistanceKm : segment.countryParts![partIndex].distanceStats.totalDistance) * lengths[i] / totals.get(partIndex)! : 0,
  }));
  const waypointCountries: Record<string, string> = {};
  for (const waypoint of segment.waypoints) {
    let closest = Infinity, country = UNASSIGNED;
    for (const piece of pieces) {
      const distance = nearestPointOnLine(lineString(piece.coordinates), waypoint.coordinates).properties.dist;
      if (distance < closest - 1e-8) { closest = distance; country = piece.country; }
      else if (Math.abs(distance - closest) <= 1e-8 && country !== piece.country) country = UNASSIGNED;
    }
    waypointCountries[waypoint.id] = country;
  }
  const result = { pieces, distanceKmByCountry, totalDistanceKm, shares: Object.fromEntries(Object.entries(distanceKmByCountry).map(([code, distance]) => [code, totalDistanceKm ? distance / totalDistanceKm : 0])), waypointCountries };
  results.set(segment, result);
  return result;
}
