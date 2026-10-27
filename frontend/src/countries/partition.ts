import { booleanPointInPolygon, bbox, distance, point, polygon } from '@turf/turf';
import type { Segment } from '../../../shared/types';
import { geometryDistance, splitDateline } from '../utils/effectiveGeometry';
import { getSegmentGeometry, samePosition } from '../utils/segmentGeometry';
import type { RouteGeometry } from '../utils/effectiveGeometry';
import { BORDER_EXCURSION_METRES, UNASSIGNED } from './types';
import { makeCountryParts } from './parts';
import type { Bounds, CountryAsset, CountryPiece, CountryResult } from './types';

type Edge = { country: string; a: GeoJSON.Position; b: GeoJSON.Position; bounds: Bounds };
const boundsFor = (a: GeoJSON.Position, b: GeoJSON.Position): Bounds => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
export const overlaps = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
// Dense GPX tracks otherwise scan a two-degree bucket of border edges for
// every short step. Keep polygon lookup coarse, but index edges more finely.
const EDGE_CELL_DEGREES = 0.1;
const cells = (bounds: Bounds, size = 2) => {
  const keys: string[] = [];
  for (let x = Math.floor(bounds[0] / size); x <= Math.floor(bounds[2] / size); x++)
    for (let y = Math.floor(bounds[1] / size); y <= Math.floor(bounds[3] / size); y++) keys.push(`${x}:${y}`);
  return keys;
};
const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];

export class CountryPartitioner {
  private readonly borderToleranceMetres: number;
  private edges = new Map<string, Edge[]>();
  private polygons: { code: string; feature: GeoJSON.Feature<GeoJSON.Polygon>; bounds: Bounds }[] = [];
  private areas = new Map<string, typeof this.polygons>();

  constructor(assets: CountryAsset[], borderToleranceMetres = BORDER_EXCURSION_METRES) {
    this.borderToleranceMetres = borderToleranceMetres;
    for (const asset of assets) {
      const polygons = asset.territorial.type === 'Polygon' ? [asset.territorial.coordinates] : asset.territorial.coordinates;
      for (const coords of polygons) {
        const feature = polygon(coords);
        const area = { code: asset.code, feature, bounds: bbox(feature) as Bounds };
        this.polygons.push(area);
        for (const key of cells(area.bounds)) {
          const bucket = this.areas.get(key) || [];
          bucket.push(area);
          this.areas.set(key, bucket);
        }
        for (const ring of coords) for (let i = 1; i < ring.length; i++) {
          const edge = { country: asset.code, a: ring[i - 1], b: ring[i], bounds: boundsFor(ring[i - 1], ring[i]) };
          for (const key of cells(edge.bounds, EDGE_CELL_DEGREES)) {
            const bucket = this.edges.get(key) || [];
            bucket.push(edge);
            this.edges.set(key, bucket);
          }
        }
      }
    }
  }

  countryAt(coord: GeoJSON.Position): string {
    const candidates = this.areas.get(`${Math.floor(coord[0] / 2)}:${Math.floor(coord[1] / 2)}`) || [];
    const matches = new Set(candidates.filter(p => overlaps(p.bounds, [coord[0], coord[1], coord[0], coord[1]]) && booleanPointInPolygon(point(coord), p.feature)).map(p => p.code));
    return matches.size === 1 ? [...matches][0] : UNASSIGNED;
  }

  partition(segment: Segment, geometry: RouteGeometry): CountryResult {
    const steps = this.partitionSteps(segment, geometry);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  *splitSegmentSteps(segment: Segment) {
    const source = getSegmentGeometry(segment);
    const coordinates = segment.transportMode === 'flight' && !source?.coordinates.length ? segment.waypoints.map(w => w.coordinates) : source?.coordinates || segment.waypoints.map(w => w.coordinates);
    const geometry = { type: 'MultiLineString' as const, coordinates: splitDateline(coordinates) };
    let pieces: CountryPiece[];
    if (segment.routingProfile === 'teleport') pieces = geometry.coordinates.map(coordinates => ({ country: UNASSIGNED, coordinates, distanceKm: 0 }));
    else pieces = (yield* this.partitionSteps(segment, geometry)).pieces;
    if (!pieces.length && source?.coordinates.length) pieces = [{ country: UNASSIGNED, coordinates: source.coordinates, distanceKm: 0 }];
    return makeCountryParts(segment, pieces);
  }

  private distanceToCountry(coordinate: GeoJSON.Position, country: string): number {
    const metres = 6371008.8 * Math.PI / 180;
    const xScale = metres * Math.cos(coordinate[1] * Math.PI / 180);
    const dx = this.borderToleranceMetres / xScale, dy = this.borderToleranceMetres / metres;
    const bounds: Bounds = [coordinate[0] - dx, coordinate[1] - dy, coordinate[0] + dx, coordinate[1] + dy];
    let closest = Infinity;
    for (const edge of new Set(cells(bounds, EDGE_CELL_DEGREES).flatMap(key => this.edges.get(key) || []))) {
      if (edge.country !== country || !overlaps(bounds, edge.bounds)) continue;
      const ax = (edge.a[0] - coordinate[0]) * xScale, ay = (edge.a[1] - coordinate[1]) * metres;
      const bx = (edge.b[0] - coordinate[0]) * xScale, by = (edge.b[1] - coordinate[1]) * metres;
      const vx = bx - ax, vy = by - ay;
      const fraction = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / (vx * vx + vy * vy || 1)));
      closest = Math.min(closest, Math.hypot(ax + vx * fraction, ay + vy * fraction));
    }
    return closest;
  }

  private *shallowExcursion(coordinates: GeoJSON.Position[], country: string): Generator<void, boolean> {
    let started = performance.now();
    for (let i = 1; i < coordinates.length; i++) {
      const pending = [[coordinates[i - 1], coordinates[i]]];
      while (pending.length) {
        if (performance.now() - started >= 16) { yield; started = performance.now(); }
        const [a, b] = pending.pop()!;
        const depth = Math.max(this.distanceToCountry(a, country), this.distanceToCountry(b, country));
        if (depth > this.borderToleranceMetres) return false;
        const length = distance(a, b) * 1000;
        // Distance to a boundary cannot grow faster than distance along the route.
        if (depth + length / 2 <= this.borderToleranceMetres) continue;
        if (length < 0.02) return false;
        const middle = a.map((value, axis) => (value + b[axis]) / 2);
        pending.push([a, middle], [middle, b]);
      }
    }
    return true;
  }

  *partitionSteps(segment: Segment, geometry: RouteGeometry): Generator<void, CountryResult> {
    const originalPoints = new Set(geometry.coordinates.flat());
    let pieces: CountryPiece[] = [];
    const distanceKmByCountry: Record<string, number> = {};
    const excluded = segment.routingProfile === 'teleport';
    const flight = segment.transportMode === 'flight';
    let sliceStarted = performance.now();
    if (!excluded) for (const line of geometry.coordinates) {
      // Split each original edge independently: repeated coordinates must not erase travel.
      for (let i = 1; i < line.length; i++) {
        if (performance.now() - sliceStarted >= 16) { yield; sliceStarted = performance.now(); }
        const a = line[i - 1], b = line[i], r = [b[0] - a[0], b[1] - a[1]];
        const total = distance(a, b);
        if (!total) {
          const previous = pieces.at(-1);
          if (previous && samePosition(previous.coordinates.at(-1)!, a)) previous.coordinates.push(b);
          else pieces.push({ country: flight ? UNASSIGNED : this.countryAt(a), coordinates: [a, b], distanceKm: 0 });
          continue;
        }
        const bounds = boundsFor(a, b);
        const cuts = [0, 1];
        let nearBorder = false;
        if (!flight) {
          const candidates = new Set(cells(bounds, EDGE_CELL_DEGREES).flatMap(key => this.edges.get(key) || []));
          for (const edge of candidates) {
            if (!overlaps(bounds, edge.bounds)) continue;
            nearBorder = true;
            const s = [edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]], q = [edge.a[0] - a[0], edge.a[1] - a[1]];
            const denominator = cross(r, s);
            if (Math.abs(denominator) > 1e-15) {
              const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
              if (t > 0 && t < 1 && u >= -1e-10 && u <= 1 + 1e-10) cuts.push(t);
            } else if (Math.abs(cross(q, r)) < 1e-12) {
              const axis = Math.abs(r[0]) >= Math.abs(r[1]) ? 0 : 1;
              for (const end of [edge.a, edge.b]) {
                const t = (end[axis] - a[axis]) / r[axis];
                if (t > 0 && t < 1) cuts.push(t);
              }
            }
          }
        }
        cuts.sort((x, y) => x - y);
        const unique = cuts.filter((t, index) => !index || t - cuts[index - 1] > 1e-10);
        const at = (t: number) => t === 0 ? a : t === 1 ? b : a.map((v, j) => v + ((b[j] ?? v) - v) * t);
        const lengths = unique.slice(1).map((t, j) => distance(at(unique[j]), at(t)));
        const splitTotal = lengths.reduce((sum, value) => sum + value, 0);
        for (let j = 1; j < unique.length; j++) {
          const start = at(unique[j - 1]), end = at(unique[j]);
          const previous = pieces.at(-1);
          // A connected step cannot change country without intersecting a
          // border. Avoid scanning whole country polygons for every GPX point.
          // Any overlapping border-edge bounds still require a fresh lookup,
          // preserving endpoint, shared-border and overlap handling.
          const country = flight ? UNASSIGNED : !nearBorder && previous && samePosition(previous.coordinates.at(-1)!, start)
            ? previous.country : this.countryAt(at((unique[j - 1] + unique[j]) / 2));
          const distanceKm = total * lengths[j - 1] / splitTotal;
          if (previous?.country === country && samePosition(previous.coordinates.at(-1)!, start)) {
            previous.coordinates.push(end);
            previous.distanceKm += distanceKm;
          } else pieces.push({ country, coordinates: [start, end], distanceKm });
        }
      }
    }
    if (!flight && this.borderToleranceMetres > 0) {
      const merged: CountryPiece[] = [];
      for (const piece of pieces) {
        merged.push(piece);
        while (merged.length >= 3) {
          const [a, b, c] = merged.slice(-3);
          if (a.country !== c.country || a.country === b.country || a.country === UNASSIGNED || b.country === UNASSIGNED ||
            !samePosition(a.coordinates.at(-1)!, b.coordinates[0]) || !samePosition(b.coordinates.at(-1)!, c.coordinates[0]) ||
            !(yield* this.shallowExcursion(b.coordinates, a.country))) break;
          for (const part of [b, c]) for (let i = 1; i < part.coordinates.length; i++) a.coordinates.push(part.coordinates[i]);
          a.distanceKm += b.distanceKm + c.distanceKm;
          merged.splice(-2, 2);
        }
      }
      pieces = merged;
    }
    for (const piece of pieces) {
      piece.coordinates = piece.coordinates.filter((coordinate, i, line) => i === 0 || i === line.length - 1 || originalPoints.has(coordinate));
      if (piece.distanceKm > 0) distanceKmByCountry[piece.country] = (distanceKmByCountry[piece.country] || 0) + piece.distanceKm;
    }
    const totalDistanceKm = excluded ? 0 : geometryDistance(geometry);
    const waypointCountries: Record<string, string> = {};
    for (const waypoint of segment.waypoints) {
      if (performance.now() - sliceStarted >= 16) { yield; sliceStarted = performance.now(); }
      waypointCountries[waypoint.id] = flight ? UNASSIGNED : this.countryAt(waypoint.coordinates);
    }
    return {
      pieces, distanceKmByCountry, totalDistanceKm,
      shares: Object.fromEntries(Object.entries(distanceKmByCountry).map(([code, km]) => [code, totalDistanceKm ? km / totalDistanceKm : 0])),
      waypointCountries
    };
  }
}
