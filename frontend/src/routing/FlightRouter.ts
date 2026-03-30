import type { TransportMode } from '../../../shared/types';
import { greatCircle } from '@turf/turf';
import type { IRoutingService } from './RoutingService';

export class FlightRouter implements IRoutingService {
  name = 'Flight Router';

  async route(waypoints: [number, number][], _profile: string): Promise<GeoJSON.LineString> {
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
  }

  isAvailable(): boolean {
    return true;
  }

  getAttribution() {
    return undefined;
  }

  getRoutingProfiles(mode: TransportMode): string[] {
    if (mode === 'flight' || mode === 'other') return ['flight'];
    return [];
  }
}
