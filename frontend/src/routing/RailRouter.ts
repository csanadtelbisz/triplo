import type { TransportMode } from '../../../shared/types';
import type { IRoutingService } from './RoutingService';

export class RailRouter implements IRoutingService {
  name = 'Rail Router';

  async route(waypoints: [number, number][], _profile: string): Promise<GeoJSON.LineString> {
    return { type: 'LineString', coordinates: waypoints };
  }

  isAvailable(): boolean {
    return false;
  }

  getAttribution() {
    return undefined;
  }

  getRoutingProfiles(mode: TransportMode): string[] {
    if (mode === 'rail' || mode === 'subway' || mode === 'other') return ['rail'];
    return [];
  }
}
