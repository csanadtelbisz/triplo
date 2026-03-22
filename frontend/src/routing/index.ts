import type { RoutingMode } from '../../../shared/types';
import { flightRouter } from './FlightRouter';
import { dummyRouter } from './DummyRouter';

export type RoutingService = (waypoints: [number, number][]) => Promise<GeoJSON.LineString>;

export const route = async (waypoints: [number, number][], mode: RoutingMode): Promise<GeoJSON.LineString> => {
  if (waypoints.length < 2) {
    return { type: 'LineString', coordinates: waypoints };
  }

  switch (mode) {
    case 'flight':
      return flightRouter(waypoints);
    default:
      return dummyRouter(waypoints);
  }
};