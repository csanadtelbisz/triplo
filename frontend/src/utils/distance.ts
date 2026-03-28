import * as turf from '@turf/turf';
import type { Waypoint, Trip } from '../../../shared/types';

export interface DistanceStats {
  distanceKm: number;
  hasElevation: boolean;
  elevationUp: number;
  elevationDown: number;
}

export function getDistanceStats(wp1: Waypoint, wp2: Waypoint, geometry: GeoJSON.LineString): DistanceStats {
  if (!wp1.coordinates || !wp2.coordinates || wp1.coordinates.length < 2 || wp2.coordinates.length < 2) {
    return { distanceKm: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 };
  }

  if (!geometry || !geometry.coordinates || geometry.coordinates.length < 2) {
      const startPt = turf.point(wp1.coordinates as [number, number]);
      const endPt = turf.point(wp2.coordinates as [number, number]);
      return {
          distanceKm: turf.distance(startPt, endPt, { units: 'kilometers' }),
          hasElevation: false,
          elevationUp: 0,
          elevationDown: 0
      };
  }

  try {
    const startPt = turf.point(wp1.coordinates as [number, number]);
    const endPt = turf.point(wp2.coordinates as [number, number]);
    const sliced = turf.lineSlice(startPt, endPt, geometry);
    const distanceKm = turf.length(sliced, { units: 'kilometers' });
    
    let elevationUp = 0; 
    let elevationDown = 0; 
    let hasElevation = false;
    
    const coords = sliced.geometry.coordinates;
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
    const startPt = turf.point(wp1.coordinates as [number, number]);
    const endPt = turf.point(wp2.coordinates as [number, number]);
    return {
       distanceKm: turf.distance(startPt, endPt, { units: 'kilometers' }),
       hasElevation: false,
       elevationUp: 0,
       elevationDown: 0
    };
  }
}

export function getTripDistanceSummary(trip: Trip) {
  let totalDistance = 0;
  const distanceByMode: Record<string, number> = {};

  for (const seg of trip.segments) {
    let segDist = 0;
    
    if (seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length >= 2) {
        segDist = turf.length(turf.feature(seg.geometry), { units: 'kilometers' });
    } else if (seg.waypoints.length >= 2) {
        for (let i = 0; i < seg.waypoints.length - 1; i++) {
            const w1 = seg.waypoints[i];
            const w2 = seg.waypoints[i+1];
            if (w1.coordinates?.length >= 2 && w2.coordinates?.length >= 2) {
                segDist += turf.distance(turf.point(w1.coordinates as [number, number]), turf.point(w2.coordinates as [number, number]), { units: 'kilometers' });
            }
        }
    }

    totalDistance += segDist;
    distanceByMode[seg.detailedMode] = (distanceByMode[seg.detailedMode] || 0) + segDist;
  }

  return { totalDistance, distanceByMode };
}
export function getSegmentDistanceSummary(seg: Trip['segments'][0]) {
  let totalDistance = 0;
  let elevationUp = 0;
  let elevationDown = 0;
  let hasElevation = false;

  if (seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length >= 2) {
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
