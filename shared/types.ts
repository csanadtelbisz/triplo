// shared/types.ts

export type TransportMode = 'walk' | 'hike' | 'run' | 'bike' | 'car' | 'taxi' | 'bus' | 'rail' | 'subway' | 'flight' | 'ferry' | 'other';

export const TRANSPORT_MODES: TransportMode[] = ['walk', 'hike', 'run', 'bike', 'car', 'taxi', 'bus', 'rail', 'subway', 'flight', 'ferry', 'other'];

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
    subtype?: string;
    details?: any;
  };
}

export interface SegmentDistanceStats {
  totalDistance: number;
  hasElevation: boolean;
  elevationUp: number;
  elevationDown: number;
}

export interface CountryPart {
  country: string;
  geometry: GeoJSON.LineString;
  distanceStats: SegmentDistanceStats;
}

export interface Segment {
  id: string; // UUID
  transportMode: TransportMode;
  routingProfile: string;
  source: 'router' | 'gpx' | 'manual';
  routingService: string;
  geometry?: GeoJSON.LineString;
  countryParts?: CountryPart[];
  waypoints: Waypoint[];
  name?: string;
  customColor?: string;
  customIcon?: string;
  isHidden?: boolean;
  countryDistances?: Record<string, number>;
  distanceStats?: SegmentDistanceStats;
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
  countryDataRevision?: string;
  createdAt: string;
  updatedAt: string;
  sourceService?: string;
  metadata?: any;
  tripDistanceSummary?: {
    totalDistance: number;
    distanceByMode: Record<string, number>;
  };
}

/** The small record stored when a user saves somebody else's shared trip. */
export interface SharedTripReference {
  id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  shareLink: string;
  metadata: {
    isSharedTripReference: true;
    sharedService?: string;
  };
}
