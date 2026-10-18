import type { Segment, SegmentDistanceStats } from '../../../shared/types';

const geometries = new WeakMap<Segment, GeoJSON.LineString>();
const routeIdentities = new WeakMap<Segment, object>();

/** Preserve a route's identity through representation and derived-cache changes. */
export function copySegmentGeometryIdentity(source: Segment, target: Segment): void {
  const identity = routeIdentities.get(source) || {};
  routeIdentities.set(source, identity);
  routeIdentities.set(target, identity);
}
export function sameSegmentGeometryIdentity(a: Segment, b: Segment): boolean {
  return routeIdentities.has(a) && routeIdentities.get(a) === routeIdentities.get(b);
}
export const samePosition = (a: GeoJSON.Position, b: GeoJSON.Position) => a.length === b.length && a.every((v, i) => v === b[i]);

export function getSegmentGeometry(segment: Segment): GeoJSON.LineString | undefined {
  if (segment.geometry) return segment.geometry;
  if (!segment.countryParts) return undefined;
  let geometry = geometries.get(segment);
  if (!geometry) {
    const coordinates: GeoJSON.Position[] = [];
    for (const part of segment.countryParts) {
      const line = part.geometry.coordinates;
      const joined = coordinates.length && line.length && samePosition(coordinates.at(-1)!, line[0]);
      for (let i = joined ? 1 : 0; i < line.length; i++) coordinates.push(line[i]);
    }
    geometry = { type: 'LineString', coordinates };
    geometries.set(segment, geometry);
  }
  return geometry;
}

export function countryPartStats(segment: Segment): SegmentDistanceStats | undefined {
  if (!segment.countryParts) return undefined;
  return segment.countryParts.reduce<SegmentDistanceStats>((sum, part) => ({
    totalDistance: sum.totalDistance + part.distanceStats.totalDistance,
    hasElevation: sum.hasElevation || part.distanceStats.hasElevation,
    elevationUp: sum.elevationUp + part.distanceStats.elevationUp,
    elevationDown: sum.elevationDown + part.distanceStats.elevationDown,
  }), { totalDistance: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 });
}

export function comparisonGeometry(geometry: GeoJSON.LineString | undefined): GeoJSON.LineString | undefined {
  if (!geometry) return geometry;
  const coordinates: GeoJSON.Position[] = [];
  for (const original of geometry.coordinates) {
    const coordinate = [...original];
    const previous = coordinates.at(-1);
    if (previous) {
      while (coordinate[0] - previous[0] > 180) coordinate[0] -= 360;
      while (coordinate[0] - previous[0] < -180) coordinate[0] += 360;
      if (samePosition(coordinate, previous)) continue;
    }
    while (coordinates.length >= 2) {
      const a = coordinates.at(-2)!, b = coordinates.at(-1)!;
      const axis = Math.abs(coordinate[0] - a[0]) >= Math.abs(coordinate[1] - a[1]) ? 0 : 1;
      const length = coordinate[axis] - a[axis];
      const fraction = length ? (b[axis] - a[axis]) / length : -1;
      if (fraction < 0 || fraction > 1 || a.length !== b.length || b.length !== coordinate.length ||
        b.some((value, i) => Math.abs(value - (a[i] + (coordinate[i] - a[i]) * fraction)) > 1e-9)) break;
      coordinates.pop();
    }
    coordinates.push(coordinate);
  }
  return { type: 'LineString', coordinates };
}
