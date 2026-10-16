import { booleanPointInPolygon, bbox, distance, point, polygon } from '@turf/turf';
import type { Segment } from '../../../shared/types';
import { geometryDistance } from '../utils/effectiveGeometry';
import type { RouteGeometry } from '../utils/effectiveGeometry';
import { UNASSIGNED } from './types';
import type { Bounds, CountryAsset, CountryPiece, CountryResult } from './types';

type Edge = { a: GeoJSON.Position; b: GeoJSON.Position; bounds: Bounds };
const boundsFor = (a: GeoJSON.Position, b: GeoJSON.Position): Bounds => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
export const overlaps = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const cells = (bounds: Bounds) => {
  const keys: string[] = [];
  for (let x = Math.floor(bounds[0] / 2); x <= Math.floor(bounds[2] / 2); x++)
    for (let y = Math.floor(bounds[1] / 2); y <= Math.floor(bounds[3] / 2); y++) keys.push(`${x}:${y}`);
  return keys;
};
const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];

export class CountryPartitioner {
  private edges = new Map<string, Edge[]>();
  private polygons: { code: string; feature: GeoJSON.Feature<GeoJSON.Polygon>; bounds: Bounds }[] = [];

  constructor(assets: CountryAsset[]) {
    for (const asset of assets) {
      const polygons = asset.territorial.type === 'Polygon' ? [asset.territorial.coordinates] : asset.territorial.coordinates;
      for (const coords of polygons) {
        const feature = polygon(coords);
        this.polygons.push({ code: asset.code, feature, bounds: bbox(feature) as Bounds });
        for (const ring of coords) for (let i = 1; i < ring.length; i++) {
          const edge = { a: ring[i - 1], b: ring[i], bounds: boundsFor(ring[i - 1], ring[i]) };
          for (const key of cells(edge.bounds)) {
            const bucket = this.edges.get(key) || [];
            bucket.push(edge);
            this.edges.set(key, bucket);
          }
        }
      }
    }
  }

  countryAt(coord: GeoJSON.Position): string {
    const matches = new Set(this.polygons.filter(p => overlaps(p.bounds, [coord[0], coord[1], coord[0], coord[1]]) && booleanPointInPolygon(point(coord), p.feature)).map(p => p.code));
    return matches.size === 1 ? [...matches][0] : UNASSIGNED;
  }

  partition(segment: Segment, geometry: RouteGeometry): CountryResult {
    const pieces: CountryPiece[] = [];
    const distanceKmByCountry: Record<string, number> = {};
    const excluded = segment.routingProfile === 'teleport';
    const flight = segment.transportMode === 'flight';
    if (!excluded) for (const line of geometry.coordinates) {
      // Split each original edge independently: repeated coordinates must not erase travel.
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], r = [b[0] - a[0], b[1] - a[1]];
        const total = distance(a, b);
        if (!total) continue;
        const bounds = boundsFor(a, b);
        const cuts = [0, 1];
        if (!flight) {
          const candidates = new Set(cells(bounds).flatMap(key => this.edges.get(key) || []));
          for (const edge of candidates) {
            if (!overlaps(bounds, edge.bounds)) continue;
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
        const at = (t: number) => a.map((v, j) => v + ((b[j] ?? v) - v) * t);
        const lengths = unique.slice(1).map((t, j) => distance(at(unique[j]), at(t)));
        const splitTotal = lengths.reduce((sum, value) => sum + value, 0);
        for (let j = 1; j < unique.length; j++) {
          const start = at(unique[j - 1]), end = at(unique[j]);
          const country = flight ? UNASSIGNED : this.countryAt(at((unique[j - 1] + unique[j]) / 2));
          const distanceKm = total * lengths[j - 1] / splitTotal;
          distanceKmByCountry[country] = (distanceKmByCountry[country] || 0) + distanceKm;
          const previous = pieces.at(-1);
          if (i > 1 && j === 1 && previous?.country === country && previous.coordinates.at(-1)!.every((v, k) => v === start[k])) {
            previous.coordinates.push(end);
            previous.distanceKm += distanceKm;
          } else pieces.push({ country, coordinates: [start, end], distanceKm });
        }
      }
    }
    const totalDistanceKm = excluded ? 0 : geometryDistance(geometry);
    return {
      pieces, distanceKmByCountry, totalDistanceKm,
      shares: Object.fromEntries(Object.entries(distanceKmByCountry).map(([code, km]) => [code, totalDistanceKm ? km / totalDistanceKm : 0])),
      waypointCountries: Object.fromEntries(segment.waypoints.map(w => [w.id, flight ? UNASSIGNED : this.countryAt(w.coordinates)]))
    };
  }
}
