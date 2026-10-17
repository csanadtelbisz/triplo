import { greatCircle, lineString, nearestPointOnLine, distance } from '@turf/turf';
import type { Segment } from '../../../shared/types';

export const GEOMETRY_VERSION = 1;
export type RouteGeometry = GeoJSON.MultiLineString;
const cache = new WeakMap<Segment, RouteGeometry>();

export function copyEffectiveGeometryCache(source: Segment, target: Segment): void {
  const geometry = cache.get(source);
  if (geometry) cache.set(target, geometry);
}

export function routeLines(geometry: GeoJSON.LineString | RouteGeometry): GeoJSON.Position[][] {
  return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
}

function splitDateline(coords: GeoJSON.Position[]): GeoJSON.Position[][] {
  if (coords.length < 2) return [];
  const lines = [[coords[0]]];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = [...coords[i]];
    if (Math.abs(b[0] - a[0]) > 180) {
      const adjusted = b[0] + (b[0] > a[0] ? -360 : 360);
      const edge = adjusted > a[0] ? 180 : -180;
      const t = (edge - a[0]) / (adjusted - a[0]);
      const cut = a.map((v, j) => j === 0 ? edge : v + ((b[j] ?? v) - v) * t);
      lines.at(-1)!.push(cut);
      lines.push([[ -edge, ...cut.slice(1)], b]);
    } else lines.at(-1)!.push(b);
  }
  return lines.filter(line => line.length >= 2);
}

export function getEffectiveGeometry(segment: Segment): RouteGeometry {
  const cached = cache.get(segment);
  if (cached) return cached;
  const waypoints = segment.waypoints.filter(w => w.coordinates?.length >= 2);
  let lines: GeoJSON.Position[][] = [];
  if (segment.transportMode === 'flight' && waypoints.length >= 2) {
    for (let i = 1; i < waypoints.length; i++) {
      const arc = greatCircle(waypoints[i - 1].coordinates, waypoints[i].coordinates).geometry;
      lines.push(...routeLines(arc));
    }
  } else if (segment.geometry?.coordinates.length >= 2) {
    let coords = segment.geometry.coordinates;
    const atEndpoint = (point: GeoJSON.Position, endpoint: GeoJSON.Position) => point[0] === endpoint[0] && point[1] === endpoint[1];
    const wholeTrack = waypoints.length === 2 && atEndpoint(waypoints[0].coordinates, coords[0]) && atEndpoint(waypoints[1].coordinates, coords.at(-1)!);
    if ((segment.routingService === 'gpx' || segment.routingProfile === 'Imported GPX') && waypoints.length >= 2 && !wholeTrack) {
      const first = nearestPointOnLine(lineString(coords), waypoints[0].coordinates);
      const last = nearestPointOnLine(lineString(coords), waypoints.at(-1)!.coordinates);
      if (last.properties.location < first.properties.location) {
        const after = coords.slice(first.properties.index);
        const forwardEnd = nearestPointOnLine(lineString(after.length >= 2 ? after : coords.slice(-2)), waypoints.at(-1)!.coordinates);
        if (forwardEnd.properties.dist > 0.01) coords = [...coords].reverse();
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
        const a = positions[i - 1], b = positions[i];
        if (b.position <= a.position) continue;
        lines.push([a.point, ...coords.slice(Math.floor(a.position) + 1, Math.ceil(b.position)), b.point]);
      }
    } else lines = [coords];
  } else if (segment.geometry?.coordinates.length !== 0 && waypoints.length >= 2) {
    lines = [waypoints.map(w => w.coordinates)];
  }
  const geometry: RouteGeometry = { type: 'MultiLineString', coordinates: lines.flatMap(splitDateline) };
  cache.set(segment, geometry);
  return geometry;
}

export function geometryDistance(geometry: RouteGeometry): number {
  return geometry.coordinates.reduce((sum, line) => sum + line.slice(1).reduce((d, b, i) => d + distance(line[i], b), 0), 0);
}
