import type { TransportMode } from '../../../shared/types';
import type { IRoutingService } from './RoutingService';
import iconUrl from '../assets/icons/mapy.png';

export class MapyRouter implements IRoutingService {
  name = 'Mapy Router';
  icon = iconUrl;
  private apiKey: string;

  constructor() {
    this.apiKey = import.meta.env.VITE_MAPY_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getAttribution() {
    return {
      text: 'Routing by Mapy.cz',
      link: 'https://mapy.cz/'
    };
  }

  getRoutingProfiles(mode: TransportMode): string[] {
    switch (mode) {
      case 'walk':
      case 'run':
        return ['foot_fast'];
      case 'hike':
        return ['foot_hiking', 'foot_fast'];
      case 'bike':
        return ['bike_road', 'bike_mountain'];
      case 'car':
      case 'bus':
      case 'taxi':
      case 'ferry':
        return ['car_fast', 'car_short'];
      case 'other':
        return ['foot_fast', 'foot_hiking', 'bike_road', 'bike_mountain', 'car_fast', 'car_short'];
      default:
        return [];
    }
  }

  async route(waypoints: [number, number][], profile: string): Promise<GeoJSON.LineString> {
    if (!this.isAvailable()) {
      throw new Error('Mapy API key is not configured');
    }

    if (waypoints.length < 2) {
      return { type: 'LineString', coordinates: waypoints };
    }

    let allCoordinates: [number, number][] = [];
    
    // Max 15 waypoints plus start and end, so 17 points per request.
    // Let's chunk by 15 points
    for (let i = 0; i < waypoints.length - 1; i += 15) {
      const chunk = waypoints.slice(i, i + 16);
      
      const start = chunk[0];
      const end = chunk[chunk.length - 1];
      const intermediate = chunk.slice(1, chunk.length - 1);
      
      const url = new URL('https://api.mapy.cz/v1/routing/route');
      url.searchParams.set('apikey', this.apiKey);
      url.searchParams.set('start', `${start[0]},${start[1]}`);
      url.searchParams.set('end', `${end[0]},${end[1]}`);
      url.searchParams.set('routeType', profile);
      url.searchParams.set('format', 'geojson');
      
      if (intermediate.length > 0) {
        url.searchParams.set('waypoints', intermediate.map(w => `${w[0]},${w[1]}`).join(';'));
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        const errorData = await response.text().catch(() => '');
        console.error('Mapy routing error:', errorData);
        // Fallback
        const fallbackCoords = chunk;
        if (i > 0) {
           allCoordinates.push(...fallbackCoords.slice(1));
        } else {
           allCoordinates.push(...fallbackCoords);
        }
        continue;
      }

      const data = await response.json();
      if (data.geometry && data.geometry.geometry && data.geometry.geometry.coordinates) {
        const chunkCoords = data.geometry.geometry.coordinates as [number, number][];
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

    // Now fetch elevations for the calculated coordinates
    const coordsWithEle = await this.fetchElevations(allCoordinates);

    return { type: 'LineString', coordinates: coordsWithEle };
  }

  private async fetchElevations(coords: [number, number][]): Promise<[number, number, number][]> {
    if (!this.apiKey || coords.length === 0) return coords as any;

    const CHUNK_SIZE = 256;
    const result: [number, number, number][] = [];

    for (let i = 0; i < coords.length; i += CHUNK_SIZE) {
      const chunk = coords.slice(i, i + CHUNK_SIZE);
      
      const url = new URL('https://api.mapy.cz/v1/elevation');
      url.searchParams.set('apikey', this.apiKey);
      chunk.forEach(c => url.searchParams.append('positions', `${c[0]},${c[1]}`));

      try {
        const response = await fetch(url.toString());
        if (response.ok) {
          const data = await response.json();
          const items = Array.isArray(data) ? data : (data.items || data.elevations || data.data);
          if (Array.isArray(items)) {
             chunk.forEach((c, idx) => {
               const elev = items[idx]?.elevation;
               result.push([c[0], c[1], typeof elev === 'number' ? elev : 0]);
             });
          } else {
             chunk.forEach(c => result.push([...c, 0] as [number, number, number]));
          }
        } else {
          chunk.forEach(c => result.push([...c, 0] as [number, number, number]));
        }
      } catch (err) {
         chunk.forEach(c => result.push([...c, 0] as [number, number, number]));
      }
    }
    return result;
  }
}
