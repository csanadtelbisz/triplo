// shared/types.ts

export type TransportMode = 'walk' | 'hike' | 'run' | 'bike' | 'car' | 'flight' | 'rail' | 'ferry' | 'waterway' | 'other';

export const TRANSPORT_MODES: TransportMode[] = ['walk', 'hike', 'run', 'bike', 'car', 'flight', 'rail', 'ferry', 'waterway', 'other'];

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
  source: 'router' | 'gpx' | 'manual';
  routingService: string;
  geometry: GeoJSON.LineString;
  waypoints: Waypoint[];
  name?: string;
  customColor?: string;
  customIcon?: string;
  distanceStats?: {
    totalDistance: number;
    hasElevation: boolean;
    elevationUp: number;
    elevationDown: number;
  };
  waypointDistances?: {
    distanceKm: number;
    hasElevation: boolean;
    elevationUp: number;
    elevationDown: number;
  }[];
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
  tripDistanceSummary?: {
    totalDistance: number;
    distanceByMode: Record<string, number>;
  };
}
