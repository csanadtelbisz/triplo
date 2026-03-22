import { greatCircle } from '@turf/turf';
import type { RoutingService } from './index';

export const flightRouter: RoutingService = async (waypoints) => {
  let coordinates: [number, number][] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const arc = greatCircle(waypoints[i], waypoints[i + 1]);
    // Remove the first point if it's not the first segment to avoid duplicates
    const coords = arc.geometry.coordinates as [number, number][];
    if (i > 0) {
      coordinates.push(...coords.slice(1));
    } else {
      coordinates.push(...coords);
    }
  }
  return { type: 'LineString', coordinates };
};