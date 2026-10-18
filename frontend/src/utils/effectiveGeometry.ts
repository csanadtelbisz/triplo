import { greatCircle, lineString, nearestPointOnLine, distance } from '@turf/turf';
import type { Segment } from '../../../shared/types';
import { getSegmentGeometry, samePosition } from './segmentGeometry';

export const GEOMETRY_VERSION = 2;
export type RouteGeometry = GeoJSON.MultiLineString;
const cache = new WeakMap<Segment, RouteGeometry>();

export function copyEffectiveGeometryCache(source: Segment, target: Segment): void {
  const geometry = cache.get(source);
  if (geometry) cache.set(target, geometry);
}

export function routeLines(geometry: GeoJSON.LineString | RouteGeometry): GeoJSON.Position[][] {
  return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
}

export function splitDateline(coords: GeoJSON.Position[]): GeoJSON.Position[][] {
  if (coords.length < 2) return [];
  const lines = [[coords[0]]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = [...coords[i]];
    if (Math.abs(b[0] - a[0]) > 180) {
      const adjusted = b[0] + (b[0] > a[0] ? -360 : 360);
      if (adjusted === a[0]) { lines.push([b]); continue; }
      const edge = adjusted > a[0] ? 180 : -180;
      const t = (edge - a[0]) / (adjusted - a[0]);
      const cut = a.map((v, j) => j === 0 ? edge : v + ((b[j] ?? v) - v) * t);
      lines.at(-1)!.push(cut);
      lines.push([[ -edge, ...cut.slice(1)], b]);
    } else lines.at(-1)!.push(b);
  }
  return lines.filter(line => line.length >= 2);
}

export function routeTraversal(segment: Segment) {
  const waypoints = segment.waypoints.filter(w => w.coordinates?.length >= 2);
  const source = getSegmentGeometry(segment);
  let coords = source?.coordinates || waypoints.map(w => w.coordinates);
  const sections: [number, number, GeoJSON.Position?, GeoJSON.Position?][] = [];
  let reversed = false;
  if (coords.length >= 2) {
    const atEndpoint = (point: GeoJSON.Position, endpoint: GeoJSON.Position) => point[0] === endpoint[0] && point[1] === endpoint[1];
    const wholeTrack = waypoints.length === 2 && atEndpoint(waypoints[0].coordinates, coords[0]) && atEndpoint(waypoints[1].coordinates, coords.at(-1)!);
    if ((segment.routingService === 'gpx' || segment.routingProfile === 'Imported GPX') && waypoints.length >= 2 && !wholeTrack) {
      const first = nearestPointOnLine(lineString(coords), waypoints[0].coordinates);
      const last = nearestPointOnLine(lineString(coords), waypoints.at(-1)!.coordinates);
      if (last.properties.location < first.properties.location) {
        const after = coords.slice(first.properties.index);
        const forwardEnd = nearestPointOnLine(lineString(after.length >= 2 ? after : coords.slice(-2)), waypoints.at(-1)!.coordinates);
        if (forwardEnd.properties.dist > 0.01) { coords = [...coords].reverse(); reversed = true; }
      }
      // Search forward along the track so revisiting a location retains its traversal.
      let floor = 0;
      const positions = waypoints.map((wp, waypointIndex) => {
        const remaining = coords.slice(Math.min(floor, coords.length - 2));
        const reverse = waypointIndex === waypoints.length - 1;
        const search = reverse ? [...remaining].reverse() : remaining;
        const snapped = nearestPointOnLine(lineString(search), wp.coordinates);
        const localIndex = reverse ? Math.max(0, remaining.length - 2 - snapped.properties.index) : snapped.properties.index;
        const index = Math.min(floor, coords.length - 2) + localIndex;
        const a = coords[index], b = coords[Math.min(index + 1, coords.length - 1)];
        const edgeLength = distance(a, b);
        const fraction = edgeLength ? Math.min(1, distance(a, snapped.geometry.coordinates) / edgeLength) : 0;
        floor = index;
        const point = [...snapped.geometry.coordinates];
        if (a.length > 2 && b.length > 2) point[2] = a[2] + (b[2] - a[2]) * fraction;
        return { position: index + fraction, point };
      });
      for (let i = 1; i < positions.length; i++) {
        if (positions[i].position > positions[i - 1].position) sections.push([positions[i - 1].position, positions[i].position, positions[i - 1].point, positions[i].point]);
      }
    } else sections.push([0, coords.length - 1]);
  }
  return { coords, sections, reversed };
}

export function sliceRoute(coords: GeoJSON.Position[], start: number, end: number): GeoJSON.Position[] {
  const at = (position: number) => {
    const index = Math.min(Math.floor(position), coords.length - 2), fraction = position - index;
    if (fraction === 0) return coords[index];
    if (fraction === 1) return coords[index + 1];
    return coords[index].map((value, axis) => value + ((coords[index + 1][axis] ?? value) - value) * fraction);
  };
  return [at(start), ...coords.slice(Math.floor(start) + 1, Math.ceil(end)), at(end)];
}

export function getEffectiveGeometry(segment: Segment): RouteGeometry {
  const cached = cache.get(segment);
  if (cached) return cached;
  const waypoints = segment.waypoints.filter(w => w.coordinates?.length >= 2);
  let lines: GeoJSON.Position[][] = [];
  if (segment.transportMode === 'flight' && waypoints.length >= 2) {
    for (let i = 1; i < waypoints.length; i++) lines.push(...routeLines(greatCircle(waypoints[i - 1].coordinates, waypoints[i].coordinates).geometry));
  } else {
    const { coords, sections } = routeTraversal(segment);
    lines = sections.map(([start, end, a, b]) => a && b ? [a, ...coords.slice(Math.floor(start) + 1, Math.ceil(end)), b] : sliceRoute(coords, start, end));
  }
  const geometry: RouteGeometry = { type: 'MultiLineString', coordinates: lines.flatMap(splitDateline) };
  cache.set(segment, geometry);
  return geometry;
}

export function activeCountryGeometries(segment: Segment): { partIndex: number; coordinates: GeoJSON.Position[] }[] {
  const { coords, sections, reversed } = routeTraversal(segment);
  let index = 0;
  const spans = (segment.countryParts || []).map((part, partIndex) => {
    const start = index;
    const previous = partIndex ? segment.countryParts![partIndex - 1].geometry.coordinates.at(-1) : undefined;
    if (previous && part.geometry.coordinates.length && !samePosition(previous, part.geometry.coordinates[0])) index++;
    const from = partIndex && previous && !samePosition(previous, part.geometry.coordinates[0]) ? index : start;
    index += Math.max(0, part.geometry.coordinates.length - 1);
    return { partIndex, start: reversed ? coords.length - 1 - index : from, end: reversed ? coords.length - 1 - from : index };
  });
  if (reversed) spans.reverse();
  return sections.flatMap(([from, to, a, b]) => spans.flatMap(span => {
    const start = Math.max(from, span.start), end = Math.min(to, span.end);
    if (end <= start) return [];
    const line = sliceRoute(coords, start, end);
    if (start === from && a) line[0] = a;
    if (end === to && b) line[line.length - 1] = b;
    return splitDateline(line).map(coordinates => ({ partIndex: span.partIndex, coordinates }));
  }));
}

export function geometryDistance(geometry: RouteGeometry): number {
  return geometry.coordinates.reduce((sum, line) => sum + line.slice(1).reduce((d, b, i) => d + distance(line[i], b), 0), 0);
}
