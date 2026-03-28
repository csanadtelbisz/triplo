import type { TransportMode } from '../../../shared/types';
import type { IRoutingService } from './RoutingService';

export class StraightLineRouter implements IRoutingService {
  name = 'Straight Line Router';

  async route(waypoints: [number, number][], _profile: string): Promise<GeoJSON.LineString> {
    return { type: 'LineString', coordinates: waypoints };
  }

  isAvailable(): boolean {
    return true;
  }

  getAttribution() {
    return undefined;
  }

  getRoutingProfiles(_mode: TransportMode): string[] {
    return ['straight'];
  }
}
