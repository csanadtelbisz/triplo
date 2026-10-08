import type { TransportMode } from '../../../shared/types';
import type { IRoutingService, ApiKeyTestResult } from './RoutingService';
import { getApiKey, GOOGLE_MAPS_API_CONFIGURATION } from '../utils/apiKeyPreferences';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const FIELD_MASK = 'routes.polyline.encodedPolyline';

type GoogleTravelMode = 'DRIVE' | 'WALK' | 'BICYCLE' | 'TRANSIT';

export class GoogleMapsRouter implements IRoutingService {
  name = 'Google Maps Router';

  isAvailable(): boolean {
    return !!getApiKey('googleMapsApiKey');
  }

  getApiKeyConfiguration() {
    return GOOGLE_MAPS_API_CONFIGURATION;
  }

  getAttribution() {
    return { text: 'Routing by Google Maps', link: 'https://maps.google.com/' };
  }

  getRoutingProfiles(mode: TransportMode): string[] {
    switch (mode) {
      case 'walk':
      case 'run':
      case 'hike':
        return ['walk'];
      case 'bike':
        return ['bicycle'];
      case 'car':
      case 'taxi':
      case 'bus':
        return ['drive'];
      case 'rail':
      case 'subway':
        return ['transit_train', 'transit_rail'];
      case 'ferry':
        // Routes API includes ferries as transit vehicles but has no ferry-only transit preference.
        return ['transit_ferry'];
      case 'other':
        return ['walk', 'bicycle', 'drive', 'transit_train', 'transit_ferry'];
      default:
        return [];
    }
  }

  async testApiKey(apiKey: string): Promise<ApiKeyTestResult> {
    try {
      const response = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify({
          origin: this.toWaypoint([14.4208, 50.088]),
          destination: this.toWaypoint([14.4378, 50.0755]),
          travelMode: 'DRIVE',
        }),
      });
      if (response.ok) return { ok: true, status: response.status };
      const body = await response.json().catch(() => null);
      return { ok: false, status: response.status, message: body?.error?.message || response.statusText };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Network request failed' };
    }
  }

  async route(waypoints: [number, number][], profile: string): Promise<GeoJSON.LineString> {
    const apiKey = getApiKey('googleMapsApiKey');
    if (!apiKey) throw new Error('Google Maps API key is not configured');
    if (waypoints.length < 2) return { type: 'LineString', coordinates: waypoints };

    const transit = profile.startsWith('transit_');
    const travelMode: GoogleTravelMode = transit
      ? 'TRANSIT'
      : profile === 'walk' ? 'WALK'
        : profile === 'bicycle' ? 'BICYCLE'
          : 'DRIVE';
    const allCoordinates: [number, number][] = [];

    // Transit routes do not accept intermediate waypoints, so request one leg per pair.
    // Other route types accept up to 25 intermediate waypoints per request.
    const chunkSize = transit ? 2 : 27;
    for (let i = 0; i < waypoints.length - 1; i += chunkSize - 1) {
      const chunk = waypoints.slice(i, i + chunkSize);
      const request: Record<string, unknown> = {
        origin: this.toWaypoint(chunk[0]),
        destination: this.toWaypoint(chunk[chunk.length - 1]),
        travelMode,
        polylineQuality: 'HIGH_QUALITY',
      };
      if (chunk.length > 2) request.intermediates = chunk.slice(1, -1).map(point => this.toWaypoint(point));
      if (transit && profile === 'transit_train') {
        request.transitPreferences = { allowedTravelModes: ['TRAIN'] };
      } else if (transit && profile === 'transit_rail') {
        request.transitPreferences = { allowedTravelModes: ['RAIL'] };
      }

      const response = await fetch(ROUTES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(request),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error?.message || `Google Routes API request failed (${response.status})`);
      }

      const encodedPolyline = data?.routes?.[0]?.polyline?.encodedPolyline;
      if (typeof encodedPolyline !== 'string') {
        throw new Error('Google Routes API did not return a route polyline');
      }
      const coordinates = this.decodePolyline(encodedPolyline);
      allCoordinates.push(...(i > 0 ? coordinates.slice(1) : coordinates));
    }

    return { type: 'LineString', coordinates: allCoordinates };
  }

  private toWaypoint([longitude, latitude]: [number, number]) {
    return { location: { latLng: { latitude, longitude } } };
  }

  private decodePolyline(encoded: string): [number, number][] {
    const coordinates: [number, number][] = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      latitude += result & 1 ? ~(result >> 1) : result >> 1;

      result = 0;
      shift = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      longitude += result & 1 ? ~(result >> 1) : result >> 1;
      coordinates.push([longitude / 1e5, latitude / 1e5]);
    }
    return coordinates;
  }
}
