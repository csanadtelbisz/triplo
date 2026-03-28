import type { TransportMode } from '../../../shared/types';
import type { IRoutingService } from './RoutingService';

export class GraphHopperRouter implements IRoutingService {
  name = 'GraphHopper Router';
  private apiKey: string;

  constructor() {
    this.apiKey = import.meta.env.VITE_GRAPHHOPPER_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey && this.apiKey !== 'your_graphhopper_api_key_here';
  }

  getAttribution() {
    return {
      text: 'Routing by GraphHopper',
      link: 'https://graphhopper.com/'
    };
  }

  getRoutingProfiles(mode: TransportMode): string[] {
    switch (mode) {
      case 'walk':
      case 'hike':
      case 'run':
        return ['foot', 'hike'];
      case 'bike':
        return ['bike', 'mtb', 'racingbike'];
      case 'car':
        return ['car', 'small_truck'];
      default:
        return [];
    }
  }

  async route(waypoints: [number, number][], profile: string): Promise<GeoJSON.LineString> {
    if (!this.isAvailable()) {
      throw new Error('GraphHopper API key is not configured');
    }

    if (waypoints.length < 2) {
      return { type: 'LineString', coordinates: waypoints };
    }

    let allCoordinates: [number, number][] = [];
    
    // Chunking logic: max 5 waypoints per request due to free tier limits
    for (let i = 0; i < waypoints.length - 1; i += 4) {
      const chunk = waypoints.slice(i, i + 5);
      
      const url = `https://graphhopper.com/api/1/route?key=${this.apiKey}`;
      const payload = {
        points: chunk,
        profile: profile,
        elevation: true,
        points_encoded: false,
        instructions: false
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('GraphHopper routing error:', errorData);
        // Fallback on error - use straight line for this chunk
        const fallbackCoords = chunk;
        if (i > 0) {
           allCoordinates.push(...fallbackCoords.slice(1));
        } else {
           allCoordinates.push(...fallbackCoords);
        }
        continue;
      }

      const data = await response.json();
      if (data.paths && data.paths.length > 0 && data.paths[0].points) {
        const chunkCoords = data.paths[0].points.coordinates as [number, number][];
        // Append to allCoordinates, skip the first point of the chunk if it's not the very first chunk
        // Because the first point of this chunk is the same as the last point of the previous chunk
        if (i > 0) {
          allCoordinates.push(...chunkCoords.slice(1));
        } else {
          allCoordinates.push(...chunkCoords);
        }
      } else {
        // Fallback
        const fallbackCoords = chunk;
        if (i > 0) {
           allCoordinates.push(...fallbackCoords.slice(1));
        } else {
           allCoordinates.push(...fallbackCoords);
        }
      }
    }

    return { type: 'LineString', coordinates: allCoordinates };
  }
}
