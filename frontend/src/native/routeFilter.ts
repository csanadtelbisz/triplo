import { lineString, point, pointToLineDistance } from '@turf/turf';
import type { Trip } from '../../../shared/types';
import { getEffectiveGeometry } from '../utils/effectiveGeometry';
import type { GalleryImage } from './gallery';

export const IMAGE_MAX_DISTANCE_M = 500;
// Flights are stored as a great circle, not the flown path.
export const FLIGHT_IMAGE_MAX_DISTANCE_M = 100_000;

const CHUNK_VERTICES = 32;
const METERS_PER_DEGREE = 111_320;

type Chunk = { west: number; south: number; east: number; north: number; line: GeoJSON.Feature<GeoJSON.LineString>; limit: number };

// Long tracks are cut into short chunks so most photos are rejected by a bounding box check.
function buildChunks(trip: Trip): Chunk[] {
  const chunks: Chunk[] = [];
  for (const segment of trip.segments) {
    if (segment.isHidden) continue;
    const limit = segment.transportMode === 'flight' ? FLIGHT_IMAGE_MAX_DISTANCE_M : IMAGE_MAX_DISTANCE_M;
    for (const line of getEffectiveGeometry(segment).coordinates) {
      for (let start = 0; start < line.length - 1; start += CHUNK_VERTICES - 1) {
        const coordinates = line.slice(start, start + CHUNK_VERTICES);
        const longitudes = coordinates.map(position => position[0]);
        const latitudes = coordinates.map(position => position[1]);
        chunks.push({
          west: Math.min(...longitudes),
          east: Math.max(...longitudes),
          south: Math.min(...latitudes),
          north: Math.max(...latitudes),
          line: lineString(coordinates),
          limit,
        });
      }
    }
  }
  return chunks;
}

function isNear(image: GalleryImage, chunk: Chunk): boolean {
  const latitudePadding = chunk.limit / METERS_PER_DEGREE;
  if (image.lat < chunk.south - latitudePadding || image.lat > chunk.north + latitudePadding) return false;
  const widestLatitude = Math.min(89, Math.max(Math.abs(chunk.south), Math.abs(chunk.north), Math.abs(image.lat)));
  const longitudePadding = latitudePadding / Math.max(Math.cos((widestLatitude * Math.PI) / 180), 0.01);
  if (image.lon < chunk.west - longitudePadding || image.lon > chunk.east + longitudePadding) return false;
  return pointToLineDistance(point([image.lon, image.lat]), chunk.line, { units: 'meters' }) <= chunk.limit;
}

/** Images within the distance limit of any visible segment of the trip. */
export function filterImagesNearTrip(images: GalleryImage[], trip: Trip): GalleryImage[] {
  const chunks = buildChunks(trip);
  return images.filter(image => chunks.some(chunk => isNear(image, chunk)));
}
