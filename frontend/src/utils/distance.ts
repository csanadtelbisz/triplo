import * as turf from '@turf/turf';
import type { Waypoint, Trip } from '../../../shared/types';

export interface DistanceStats {
  distanceKm: number;
  hasElevation: boolean;
  elevationUp: number;
  elevationDown: number;
}

// A path along the geometry between two waypoints should essentially never be shorter
// than the straight-line distance between them - if it is, by more than this margin, it's
// a sign a waypoint snapped to the wrong occurrence of a coordinate the route revisits.
// The margin exists purely to absorb floating point / projection noise, not to allow real
// slack.
// Also used for minimum distance treshold for snapping candidates.
const MIN_DISTANCE_TRESHOLD_METERS = 10; // 10 meters
const MIN_DISTANCE_MARGIN = 0.2; // 20% of the closest distance

// Snaps each waypoint onto the geometry in order, consuming the working copy of the line
// as it goes. Once a waypoint has been matched to a coordinate, every coordinate before it
// is dropped from the search space, so a later waypoint that happens to sit near an
// earlier part of the line (e.g. the "car" waypoint on an out-and-back hike) can never be
// snapped back onto it. Returns, for each waypoint, the index into the ORIGINAL
// (unmodified) geometry.coordinates array that it was matched to.
//
// This is the cheap, single-pass strategy - correct for the vast majority of cases, but it
// can be fooled if the routing geometry is imprecise enough that a revisited location's
// two occurrences aren't in a clean "first one wins" order. See snapWaypointsRobust for a
// slower fallback that handles that.
function snapWaypointsSimple(waypoints: Waypoint[], coordinates: GeoJSON.Position[]): number[] {
  const indices: number[] = [];
  let working = coordinates;
  let offset = 0;

  for (const wp of waypoints) {
    if (!wp.coordinates || wp.coordinates.length < 2 || working.length < 2) {
      // Nothing sensible to snap to - fall back to wherever we've consumed up to so far.
      indices.push(offset);
      continue;
    }

    const line = turf.lineString(working);
    const pt = turf.point(wp.coordinates as [number, number]);
    const snapped = turf.nearestPointOnLine(line, pt);
    // Index of the coordinate that starts the segment the snapped point falls on,
    // relative to the current working copy.
    const segIndex = (snapped.properties?.index as number) ?? 0;

    const originalIndex = offset + segIndex;
    indices.push(originalIndex);

    // Delete everything before this matched coordinate from the working copy, so
    // subsequent waypoints can only match this point onward.
    working = working.slice(segIndex);
    offset = originalIndex;
  }

  return indices;
}

interface SnapCandidate {
  index: number;
  distance: number;
}

// Collects the plausible coordinate indices a waypoint could correspond to, instead of
// just the single nearest one. Routing engines aren't always perfectly precise, so if a
// route revisits the same physical location twice, the two occurrences may end up at very
// slightly different coordinates - and the one that happens to be marginally closer isn't
// necessarily the "correct" occurrence for this waypoint. A coordinate qualifies as a
// candidate if it's within 20% of the closest distance found, or within 2 meters,
// whichever is more permissive.
function collectCandidates(wp: Waypoint, geometryPoints: GeoJSON.Feature<GeoJSON.Point>[]): SnapCandidate[] {
  if (!wp.coordinates || wp.coordinates.length < 2 || geometryPoints.length === 0) {
    return [];
  }

  const wpPoint = turf.point(wp.coordinates as [number, number]);
  const distances: SnapCandidate[] = geometryPoints.map((pt, index) => ({
    index,
    distance: turf.distance(wpPoint, pt, { units: 'meters' })
  }));

  const minDistance = Math.min(...distances.map(d => d.distance));
  const threshold = Math.max(minDistance * (1 + MIN_DISTANCE_MARGIN), MIN_DISTANCE_TRESHOLD_METERS);
  const withinThreshold = distances.filter(d => d.distance <= threshold);

  // Densely-sampled geometry can put many consecutive coordinates within the threshold of
  // a waypoint - these aren't genuinely different candidate locations, just neighbors of
  // each other, and only add noise and search overhead to the backtracking step. Collapse
  // each run of consecutive indices down to the single closest point in that run.
  return collapseConsecutiveIndices(withinThreshold).sort((a, b) => a.distance - b.distance);
}

// Groups candidates whose indices form a consecutive run (e.g. 1049, 1050, 1051) and
// keeps only the closest one from each run. Ties keep the first (lowest-index) occurrence.
function collapseConsecutiveIndices(candidates: SnapCandidate[]): SnapCandidate[] {
  if (candidates.length === 0) return candidates;

  const byIndex = [...candidates].sort((a, b) => a.index - b.index);
  const collapsed: SnapCandidate[] = [];

  let runStart = 0;
  for (let i = 1; i <= byIndex.length; i++) {
    const runEnds = i === byIndex.length || byIndex[i].index !== byIndex[i - 1].index + 1;
    if (runEnds) {
      let best = byIndex[runStart];
      for (let j = runStart + 1; j < i; j++) {
        if (byIndex[j].distance < best.distance) best = byIndex[j];
      }
      collapsed.push(best);
      runStart = i;
    }
  }

  return collapsed;
}

// Given each waypoint's candidate coordinates (closest first), picks one index per
// waypoint such that indices are non-decreasing along the waypoint order - i.e. a
// consistent path along the geometry. For each waypoint it tries the closest candidate
// first; if that choice turns out to leave a later waypoint with no valid candidate after
// it, it backtracks and tries the next-closest candidate that still comes before the one
// that was ruled out, and so on.
function selectSnapIndices(candidatesPerWaypoint: SnapCandidate[][]): number[] {
  const n = candidatesPerWaypoint.length;
  const selected: number[] = new Array(n).fill(0);
  const upperBounds: number[] = new Array(n).fill(Infinity);

  function solve(i: number, lowerBound: number): boolean {
    if (i === n) return true;

    const candidates = candidatesPerWaypoint[i];

    if (candidates.length === 0) {
      // No usable coordinates for this waypoint (e.g. missing lat/lng). It can't be
      // matched and won't be used in distance calculations either, so just pass the
      // current position through rather than failing the whole search over it.
      selected[i] = lowerBound === -Infinity ? 0 : lowerBound;
      return solve(i + 1, selected[i]);
    }

    // Closest candidate still allowed at this point (>= where the previous waypoint
    // landed, and < anything we've already ruled out for this waypoint).
    let best: SnapCandidate | null = null;
    for (const c of candidates) {
      if (c.index >= lowerBound && c.index < upperBounds[i]) {
        if (!best || c.distance < best.distance) best = c;
      }
    }

    if (!best) return false;

    selected[i] = best.index;

    if (solve(i + 1, best.index)) return true;

    // That candidate didn't leave a valid path for the remaining waypoints - rule it (and
    // anything at or after it) out, and retry with an earlier candidate instead.
    upperBounds[i] = best.index;
    return solve(i, lowerBound);
  }

  const success = solve(0, -Infinity);

  if (!success) {
    // No ordering-consistent assignment exists at all - fall back to each waypoint's own
    // closest candidate. Shouldn't happen in practice, and later waypoints may end up
    // mismatched, but it's better than leaving indices unset.
    for (let i = 0; i < n; i++) {
      const candidates = candidatesPerWaypoint[i];
      selected[i] = candidates.length > 0
        ? candidates.reduce((min, c) => (c.distance < min.distance ? c : min)).index
        : (i > 0 ? selected[i - 1] : 0);
    }
  }

  return selected;
}

// Snaps each waypoint onto the geometry, tolerating slight imprecision in the routing
// geometry when the route revisits the same location more than once (e.g. an out-and-back
// hike). Returns, for each waypoint, the index into geometry's coordinate array it was
// matched to, guaranteed to be non-decreasing along the waypoint order.
//
// This is slower than snapWaypointsSimple (O(waypoints x geometry length) just to build
// the candidate lists), so it's only meant to be used as a fallback when the simple
// strategy produces a suspicious result.
function snapWaypointsRobust(waypoints: Waypoint[], coordinates: GeoJSON.Position[]): number[] {
  if (waypoints.length === 0) return [];

  const geometryPoints = coordinates.map(coord => turf.point(coord as [number, number]));
  const candidatesPerWaypoint = waypoints.map(wp => collectCandidates(wp, geometryPoints));

  return selectSnapIndices(candidatesPerWaypoint);
}

// Computes distance/elevation stats between two coordinate indices in geometry. The
// indices are assumed to have already been resolved (e.g. via snapWaypointsSimple or
// snapWaypointsRobust) - this function does no snapping of its own, since doing so
// per-pair is what allowed waypoints to incorrectly match earlier occurrences of the same
// point on the line in the first place.
function getDistanceStats(idx1: number, idx2: number, geometry: GeoJSON.LineString): DistanceStats {
  if (!geometry || !geometry.coordinates) {
    return { distanceKm: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 };
  }

  const lo = Math.min(idx1, idx2);
  const hi = Math.max(idx1, idx2);
  const coords = geometry.coordinates.slice(lo, hi + 1);

  if (coords.length < 2) {
    return { distanceKm: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 };
  }

  try {
    const line = turf.lineString(coords);
    const distanceKm = turf.length(line, { units: 'kilometers' });

    let elevationUp = 0;
    let elevationDown = 0;
    let hasElevation = false;

    for (let i = 1; i < coords.length; i++) {
      if (coords[i - 1].length > 2 && coords[i].length > 2) {
        hasElevation = true;
        const diff = coords[i][2] - coords[i - 1][2];
        if (diff > 0) elevationUp += diff;
        else elevationDown -= diff;
      }
    }

    return { distanceKm, hasElevation, elevationUp, elevationDown };
  } catch (e) {
    return { distanceKm: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 };
  }
}

// Straight-line ("as the crow flies") distance between two waypoints, in kilometers, or
// null if either waypoint lacks usable coordinates.
function crowFliesDistanceKm(wp1: Waypoint, wp2: Waypoint): number | null {
  if (!(wp1.coordinates?.length >= 2 && wp2.coordinates?.length >= 2)) {
    return null;
  }
  return turf.distance(
    turf.point(wp1.coordinates as [number, number]),
    turf.point(wp2.coordinates as [number, number]),
    { units: 'kilometers' }
  );
}

// Computes per-waypoint-pair distance/elevation stats for a segment's waypoints. Tries the
// cheap single-pass snapping strategy first; if any pair's along-geometry distance comes
// out shorter than the straight-line distance between its waypoints (beyond a small
// tolerance for floating point noise), that's a sign a waypoint snapped to the wrong
// occurrence of a revisited coordinate, and the whole segment is recomputed with the
// slower, more careful candidate-based matching instead.
function computeWaypointDistanceStats(waypoints: Waypoint[], geometry: GeoJSON.LineString | undefined): DistanceStats[] {
  if (waypoints.length < 2) return [];

  const hasUsableGeometry = !!(geometry && geometry.coordinates && geometry.coordinates.length >= 2);

  const statsFromIndices = (indices: number[]): DistanceStats[] =>
    waypoints.slice(0, -1).map((wp1, i) => {
      const wp2 = waypoints[i + 1];
      if (!(wp1.coordinates?.length >= 2 && wp2.coordinates?.length >= 2)) {
        return { distanceKm: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 };
      }
      return getDistanceStats(indices[i], indices[i + 1], geometry!);
    });

  if (!hasUsableGeometry) {
    return waypoints.slice(0, -1).map((wp1, i) => {
      const wp2 = waypoints[i + 1];
      const crowFlies = crowFliesDistanceKm(wp1, wp2);
      if (crowFlies === null) {
        return { distanceKm: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 };
      }
      return { distanceKm: crowFlies, hasElevation: false, elevationUp: 0, elevationDown: 0 };
    });
  }

  const isSuspicious = (stats: DistanceStats[]): boolean =>
    stats.some((stat, i) => {
      const crowFlies = crowFliesDistanceKm(waypoints[i], waypoints[i + 1]);
      if (crowFlies === null) return false;
      return stat.distanceKm <= Math.max(0, crowFlies - 0.001 * MIN_DISTANCE_TRESHOLD_METERS);
    });

  const simpleIndices = snapWaypointsSimple(waypoints, geometry!.coordinates);
  const simpleStats = statsFromIndices(simpleIndices);

  if (!isSuspicious(simpleStats)) {
    return simpleStats;
  }

  const robustIndices = snapWaypointsRobust(waypoints, geometry!.coordinates);
  return statsFromIndices(robustIndices);
}

function getSegmentDistanceSummary(seg: Trip['segments'][0]) {
  let totalDistance = 0;
  let elevationUp = 0;
  let elevationDown = 0;
  let hasElevation = false;

  if (seg.routingService === 'gpx' && seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length >= 2 && seg.waypoints.length >= 2) {
      const line = turf.feature(seg.geometry) as any;
      const wpDistances = seg.waypoints.map(wp => {
          if (wp.coordinates && wp.coordinates.length >= 2) {
              const pt = turf.point(wp.coordinates as [number, number]);
              const snapped = turf.nearestPointOnLine(line, pt);
              return snapped.properties?.location as number ?? 0;
          }
          return 0;
      });
      
      for (let i = 0; i < wpDistances.length - 1; i++) {
          totalDistance += Math.abs(wpDistances[i+1] - wpDistances[i]);
      }

      // Assume elevation is calculated from the start to the end of the trimmed section
      const coords = seg.geometry.coordinates;
      for (let i = 1; i < coords.length; i++) {
          if (coords[i - 1].length > 2 && coords[i].length > 2) {
              hasElevation = true;
              const diff = (coords[i][2] || 0) - (coords[i - 1][2] || 0);
              if (diff > 0) elevationUp += diff;
              else elevationDown -= diff;
          }
      }
  } else if (seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length >= 2) {
      totalDistance = turf.length(turf.feature(seg.geometry), { units: 'kilometers' });
      const coords = seg.geometry.coordinates;
      for (let i = 1; i < coords.length; i++) {
          if (coords[i - 1].length > 2 && coords[i].length > 2) {
              hasElevation = true;
              const diff = coords[i][2] - coords[i - 1][2];
              if (diff > 0) elevationUp += diff;
              else elevationDown -= diff;
          }
      }
  } else if (seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length === 0) {
      // default 0 values are good
  } else if (seg.waypoints.length >= 2) {
      for (let i = 0; i < seg.waypoints.length - 1; i++) {
          const w1 = seg.waypoints[i];
          const w2 = seg.waypoints[i+1];
          if (w1.coordinates?.length >= 2 && w2.coordinates?.length >= 2) {
              totalDistance += turf.distance(turf.point(w1.coordinates as [number, number]), turf.point(w2.coordinates as [number, number]), { units: 'kilometers' });
          }
      }
  }

  return { totalDistance, hasElevation, elevationUp, elevationDown };
}

export function computeTripCaches(trip: Trip, affectedSegmentIds?: string[]): Trip {
  const newTrip = { ...trip };
  
  let overallTotalDistance = 0;
  const distanceByMode: Record<string, number> = {};

  const newSegments = newTrip.segments.map(seg => {
    // If affectedSegmentIds is provided and this segment is not in it, use existing caches if available
    let segDistStats = seg.distanceStats;
    let wpStats = seg.waypointDistances;
    
    // Check if computation is actually needed
    const needsComputation = !affectedSegmentIds || affectedSegmentIds.includes(seg.id) || !segDistStats || !wpStats;

    if (needsComputation) {
      // Computing Segment stats
      segDistStats = getSegmentDistanceSummary(seg);

      // Computing intermediate waypoint distances
      wpStats = computeWaypointDistanceStats(seg.waypoints, seg.geometry as GeoJSON.LineString | undefined);
    }

    if (seg.routingProfile !== 'teleport' && segDistStats) {
      overallTotalDistance += segDistStats.totalDistance;
      const modeKey = seg.transportMode === 'other' && seg.customIcon ? `other:${seg.customIcon}` : seg.transportMode;
      distanceByMode[modeKey] = (distanceByMode[modeKey] || 0) + segDistStats.totalDistance;
    }

    return {
      ...seg,
      distanceStats: segDistStats,
      waypointDistances: wpStats
    };
  });

  newTrip.segments = newSegments;
  newTrip.tripDistanceSummary = {
    totalDistance: overallTotalDistance,
    distanceByMode
  };

  return newTrip;
}
