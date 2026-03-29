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
    
    const snapped1 = turf.nearestPointOnLine(geometry, startPt);
    const snapped2 = turf.nearestPointOnLine(geometry, endPt);
    const loc1 = snapped1.properties?.location as number ?? 0;
    const loc2 = snapped2.properties?.location as number ?? 0;
    
    const distanceKm = Math.abs(loc2 - loc1);
    
    const sliced = turf.lineSlice(startPt, endPt, geometry);
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
    
    if (seg.routingService === 'gpx' && seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length >= 2 && seg.waypoints.length >= 2) {
        const line = turf.feature(seg.geometry) as turf.Feature<turf.LineString>;
        const wpDistances = seg.waypoints.map(wp => {
            if (wp.coordinates && wp.coordinates.length >= 2) {
                const pt = turf.point(wp.coordinates as [number, number]);
                const snapped = turf.nearestPointOnLine(line, pt);
                return snapped.properties?.location as number ?? 0;
            }
            return 0;
        });
        
        for (let i = 0; i < wpDistances.length - 1; i++) {
            segDist += Math.abs(wpDistances[i+1] - wpDistances[i]);
        }
    } else if (seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length >= 2) {
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
    distanceByMode[seg.transportMode] = (distanceByMode[seg.transportMode] || 0) + segDist;
  }

  return { totalDistance, distanceByMode };
}
export function getSegmentDistanceSummary(seg: Trip['segments'][0]) {
  let totalDistance = 0;
  let elevationUp = 0;
  let elevationDown = 0;
  let hasElevation = false;

  if (seg.routingService === 'gpx' && seg.geometry && seg.geometry.coordinates && seg.geometry.coordinates.length >= 2 && seg.waypoints.length >= 2) {
      const line = turf.feature(seg.geometry) as turf.Feature<turf.LineString>;
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

export function computeTripCaches(trip: Trip): Trip {
  const newTrip = { ...trip };
  
  let overallTotalDistance = 0;
  const distanceByMode: Record<string, number> = {};

  const newSegments = newTrip.segments.map(seg => {
    // Computing Segment stats
    const segDistStats = getSegmentDistanceSummary(seg);
    overallTotalDistance += segDistStats.totalDistance;
    distanceByMode[seg.transportMode] = (distanceByMode[seg.transportMode] || 0) + segDistStats.totalDistance;

    // Computing intermediate waypoint distances
    const wpStats: DistanceStats[] = [];
    if (seg.waypoints.length >= 2) {
      for (let i = 0; i < seg.waypoints.length - 1; i++) {
        const wp1 = seg.waypoints[i];
        const wp2 = seg.waypoints[i+1];
        if (wp1.coordinates?.length >= 2 && wp2.coordinates?.length >= 2) {
           wpStats.push(getDistanceStats(wp1, wp2, seg.geometry as any));
        } else {
           wpStats.push({ distanceKm: 0, hasElevation: false, elevationUp: 0, elevationDown: 0 });
        }
      }
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
