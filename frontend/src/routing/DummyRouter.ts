import type { RoutingService } from './index';

export const dummyRouter: RoutingService = async (waypoints) => {
  return { type: 'LineString', coordinates: waypoints };
};
