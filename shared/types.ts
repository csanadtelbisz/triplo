// shared/types.ts

export type TransportMode = 'walk' | 'hike' | 'run' | 'bike' | 'car' | 'flight' | 'rail' | 'ferry' | 'waterway';

export const TRANSPORT_MODES: TransportMode[] = ['walk', 'hike', 'run', 'bike', 'car', 'flight', 'rail', 'ferry', 'waterway'];

export interface Coordinates {
  lon: number;
  lat: number;
  ele?: number;
}

export interface Waypoint {
  id: string; // UUID
  coordinates: [number, number]; // [lon, lat]
  name?: string;
  description?: string;
  date?: string; // ISO 8601
  importance: 'normal' | 'hidden';
  icon?: string;
  picture?: string;
  poi?: {
    id: string | number;
    name?: string;
    type?: string;
    details?: any;
  };
}

export interface Segment {
  id: string; // UUID
  transportMode: TransportMode;
  routingProfile: string;
  source: 'router' | 'recorded_track' | 'manual';
  routingService: string;
  geometry: GeoJSON.LineString;
  waypoints: Waypoint[];
  name?: string;
}

export interface Trip {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  segments: Segment[];
  createdAt: string;
  updatedAt: string;
}
