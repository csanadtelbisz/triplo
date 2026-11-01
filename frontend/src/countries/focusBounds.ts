import type { Bounds } from './types';

const KM_PER_DEGREE = Math.PI * 6371.0088 / 180;
const DEFAULT_ISLAND_DISTANCE_KM = 500;
const ROUTE_MARGIN_DEGREES = 0.2;

/** Put a box on the world copy nearest the anchor, including across ±180°. */
function alignBounds(bounds: Bounds, anchor: Bounds): Bounds {
  const offset = 360 * Math.round(((anchor[0] + anchor[2]) - (bounds[0] + bounds[2])) / 720);
  return [bounds[0] + offset, bounds[1], bounds[2] + offset, bounds[3]];
}

function contains(bounds: Bounds, coordinate: GeoJSON.Position): boolean {
  const longitude = coordinate[0] + 360 * Math.round(((bounds[0] + bounds[2]) / 2 - coordinate[0]) / 360);
  return longitude >= bounds[0] - ROUTE_MARGIN_DEGREES && longitude <= bounds[2] + ROUTE_MARGIN_DEGREES
    && coordinate[1] >= bounds[1] - ROUTE_MARGIN_DEGREES && coordinate[1] <= bounds[3] + ROUTE_MARGIN_DEGREES;
}

/**
 * landParts are ordered largest first by the boundary index. Build local groups
 * before scoring routes so a route on a nearby island still frames the mainland.
 * All proximity checks use boxes and the original anchor, never a growing union.
 */
export function countryFocusBounds(landParts: readonly Bounds[], coordinates: readonly GeoJSON.Position[]): Bounds | undefined {
  const visited = landParts.map(bounds => coordinates.some(coordinate => contains(bounds, coordinate)));
  const assigned = new Set<number>();
  let focus: Bounds | undefined;
  let bestScore = -1;

  for (let i = 0; i < landParts.length; i++) {
    if (assigned.has(i)) continue;
    const anchor = landParts[i];
    const longitudeScale = Math.cos((anchor[1] + anchor[3]) / 2 * Math.PI / 180);
    const diameterKm = KM_PER_DEGREE * Math.hypot((anchor[2] - anchor[0]) * longitudeScale, anchor[3] - anchor[1]);
    const defaultDistanceKm = Math.min(diameterKm, DEFAULT_ISLAND_DISTANCE_KM);
    const candidates = [{ index: i, bounds: anchor, distanceKm: 0 }];

    // Preserve the map's route-bounds fallback for world-spanning boxes.
    if (anchor[2] - anchor[0] < 180) {
      for (let j = i + 1; j < landParts.length; j++) {
        if (assigned.has(j) || landParts[j][2] - landParts[j][0] >= 180) continue;
        const bounds = alignBounds(landParts[j], anchor);
        const dx = Math.max(anchor[0] - bounds[2], bounds[0] - anchor[2], 0) * longitudeScale;
        const dy = Math.max(anchor[1] - bounds[3], bounds[1] - anchor[3], 0);
        const distanceKm = KM_PER_DEGREE * Math.hypot(dx, dy);
        if (distanceKm <= diameterKm) candidates.push({ index: j, bounds, distanceKm });
      }
    }

    // A visible visit beyond the cap enables the full diameter for this group.
    const distanceLimitKm = candidates.some(part => part.distanceKm > defaultDistanceKm && visited[part.index])
      ? diameterKm : defaultDistanceKm;
    const group = candidates.filter(part => part.distanceKm <= distanceLimitKm);
    for (const part of group) assigned.add(part.index);
    const score = coordinates.filter(coordinate => group.some(part => contains(part.bounds, coordinate))).length;
    if (score <= bestScore) continue;
    bestScore = score;
    focus = group.reduce<Bounds>((bounds, part) => [
      Math.min(bounds[0], part.bounds[0]), Math.min(bounds[1], part.bounds[1]),
      Math.max(bounds[2], part.bounds[2]), Math.max(bounds[3], part.bounds[3]),
    ], [...anchor]);
  }
  return focus;
}
