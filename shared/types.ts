// shared/types.ts

export type TransportMode = 'walk' | 'hike' | 'run' | 'car' | 'flight' | 'train' | 'light_rail' | 'tram' | 'ferry' | 'waterway';
export type RoutingMode = 'foot' | 'car' | 'flight' | 'rail' | 'ferry' | 'water';

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
  detailedMode: TransportMode;
  routingMode: RoutingMode;
  source: 'router' | 'recorded_track' | 'manual';
  routerService?: string;
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
