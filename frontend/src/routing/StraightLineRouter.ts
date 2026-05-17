import type { TransportMode } from '../../../shared/types';
import type { IRoutingService } from './RoutingService';

export class StraightLineRouter implements IRoutingService {
  name = 'Straight Router';

  async route(waypoints: [number, number][], _profile: string): Promise<GeoJSON.LineString> {
    if (_profile === 'straight') {
      return { type: 'LineString', coordinates: waypoints };
    } else if (_profile === 'teleport') {
      return { type: 'LineString', coordinates: [] };
    }
    throw new Error(`Unsupported profile: ${_profile}`);
  }

  isAvailable(): boolean {
    return true;
  }

  getAttribution() {
    return undefined;
  }

  getRoutingProfiles(_mode: TransportMode): string[] {
    return ['straight', 'teleport'];
  }
}
