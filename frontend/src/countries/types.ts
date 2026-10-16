import type { Segment } from '../../../shared/types';
import type { RouteGeometry } from '../utils/effectiveGeometry';

export const UNASSIGNED = '__unassigned__';
export const COUNTRY_ALGORITHM_VERSION = 1;
export type CountryGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
export type Bounds = [number, number, number, number];
export interface CountryEntry {
  code: string;
  name: string;
  file: string;
  sha256: string;
  bounds: Bounds[];
  landBounds: Bounds;
  landParts?: Bounds[];
}
export interface CountryIndex {
  version: string;
  countries: CountryEntry[];
  attribution: string;
}
export interface CountryAsset {
  code: string;
  territorial: CountryGeometry;
  land: CountryGeometry;
}
export interface CountryPiece {
  country: string;
  coordinates: GeoJSON.Position[];
  distanceKm: number;
}
export interface CountryResult {
  distanceKmByCountry: Record<string, number>;
  shares: Record<string, number>;
  totalDistanceKm: number;
  pieces: CountryPiece[];
  waypointCountries: Record<string, string>;
}
export interface CountryData {
  index: CountryIndex;
  results: Record<string, CountryResult>;
}
export const segmentKey = (tripId: string, segmentId: string) => JSON.stringify([tripId, segmentId]);
export interface PartitionInput { segment: Segment; geometry: RouteGeometry }
