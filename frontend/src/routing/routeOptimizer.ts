import * as turf from '@turf/turf';
import type { Segment } from '../../../shared/types';
import { route } from './RoutingService';

/**
 * Optimizes the route planning to only calculate the necessary section.
 * If routing profile/service changed, or old geometry is missing, does full recalculation.
 * Otherwise, finds the changed waypoint(s) and patches the geometry.
 */
export async function optimizeSegmentRoute(newSeg: Segment, oldSeg?: Segment): Promise<GeoJSON.LineString | undefined> {
  const validCoords = newSeg.waypoints
    .filter(w => w.coordinates && w.coordinates.length === 2)
    .map(w => w.coordinates as [number, number]);

  if (validCoords.length < 2) return undefined;

  // Need full route if no old segment, no old geometry, or routing properties changed
  if (
    !oldSeg ||
    !oldSeg.geometry ||
    !oldSeg.geometry.coordinates ||
    oldSeg.geometry.coordinates.length < 2 ||
    newSeg.routingService !== oldSeg.routingService ||
    newSeg.routingProfile !== oldSeg.routingProfile ||
    newSeg.transportMode !== oldSeg.transportMode
  ) {
    return route(validCoords, newSeg.routingService, newSeg.routingProfile);
  }

  const oldWays = oldSeg.waypoints.filter(w => w.coordinates && w.coordinates.length === 2);
  const newWays = newSeg.waypoints.filter(w => w.coordinates && w.coordinates.length === 2);
  
  if (oldWays.length !== newWays.length) {
    // A point was added or removed. 
    // We could try to optimize this, but it gets complex to identify exactly which one 
    // and stitch correctly without breaking. For safety, just do full replan on add/remove.
    // (Wait, user says "when a waypoint is added/moved/deleted, only plan the route from the previous waypoint...").
    // Let's implement it if it's strictly required.
  }
  
  // Actually, comparing arrays to find a single change (addition, deletion, move):
  let firstDiff = -1;
  let lastDiffOld = -1;
  let lastDiffNew = -1;

  for (let i = 0; i < Math.min(oldWays.length, newWays.length); i++) {
    if (oldWays[i].id !== newWays[i].id || oldWays[i].coordinates[0] !== newWays[i].coordinates[0] || oldWays[i].coordinates[1] !== newWays[i].coordinates[1]) {
      firstDiff = i;
      break;
    }
  }

  // If no change from the start, check if anything at all changed
  if (firstDiff === -1 && oldWays.length === newWays.length) {
    return oldSeg.geometry; // No geometries changed
  }
  if (firstDiff === -1) {
    firstDiff = Math.min(oldWays.length, newWays.length);
  }

  for (let i = 0; i < Math.min(oldWays.length, newWays.length); i++) {
    const o = oldWays.length - 1 - i;
    const n = newWays.length - 1 - i;
    if (oldWays[o].id !== newWays[n].id || oldWays[o].coordinates[0] !== newWays[n].coordinates[0] || oldWays[o].coordinates[1] !== newWays[n].coordinates[1]) {
      lastDiffOld = o;
      lastDiffNew = n;
      break;
    }
  }

  if (lastDiffOld === -1 || lastDiffNew === -1) {
    // Only happens if one array is prefix of another
    lastDiffOld = oldWays.length - 1;
    lastDiffNew = newWays.length - 1;
  }

  // The changed section in old coords is from max(0, firstDiff - 1) to min(oldWays.length - 1, lastDiffOld + 1)
  // The changed section in new coords is from max(0, firstDiff - 1) to min(newWays.length - 1, lastDiffNew + 1)
  
  const startIdx = Math.max(0, firstDiff - 1);
  const endIdxOld = Math.min(oldWays.length - 1, lastDiffOld + 1);
  const endIdxNew = Math.min(newWays.length - 1, lastDiffNew + 1);

  // If the segment changed entirely, just plan it all
  if (startIdx === 0 && endIdxNew === newWays.length - 1) {
     return route(validCoords, newSeg.routingService, newSeg.routingProfile);
  }

  // Calculate the new chunk
  const coordsToPlan = newWays.slice(startIdx, endIdxNew + 1).map(w => w.coordinates as [number, number]);
  const newChunk = await route(coordsToPlan, newSeg.routingService, newSeg.routingProfile);

  if (!newChunk || !newChunk.coordinates || newChunk.coordinates.length === 0) {
    // fallback to full route if optimization fails
    return route(validCoords, newSeg.routingService, newSeg.routingProfile);
  }

  // Find splice points in old geometry
  const geomLine = turf.lineString(oldSeg.geometry.coordinates);
  
  let geomStartIdx = 0;
  if (startIdx > 0) {
    const ptStart = turf.point(oldWays[startIdx].coordinates as [number, number]);
    const snappedStart = turf.nearestPointOnLine(geomLine, ptStart);
    geomStartIdx = snappedStart.properties.index || 0;
  }

  let geomEndIdx = oldSeg.geometry.coordinates.length - 1;
  if (endIdxOld < oldWays.length - 1) {
    const ptEnd = turf.point(oldWays[endIdxOld].coordinates as [number, number]);
    const snappedEnd = turf.nearestPointOnLine(geomLine, ptEnd);
    geomEndIdx = snappedEnd.properties.index || oldSeg.geometry.coordinates.length - 1;
    // ensure we don't accidentally get an index before geomStartIdx
    if (geomEndIdx < geomStartIdx) {
       geomEndIdx = geomStartIdx;
    }
  }

  const beforeCoords = oldSeg.geometry.coordinates.slice(0, geomStartIdx);
  let afterCoords = oldSeg.geometry.coordinates.slice(geomEndIdx + 1);

  // Combine
  const combinedCoords = [...beforeCoords, ...newChunk.coordinates, ...afterCoords];
  return { type: 'LineString', coordinates: combinedCoords };
}
