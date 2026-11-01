import type { Segment } from '../../../shared/types';
import type { CountryPiece } from '../countries/types';
import type { RouteGeometry } from '../utils/effectiveGeometry';

export const routingInputKey = (segment: Segment) => JSON.stringify([
  segment.source, segment.routingService, segment.routingProfile, segment.transportMode,
  segment.waypoints.map(waypoint => [waypoint.id, waypoint.coordinates]),
]);

/** Presentation state only: never stored in trips or sent to calculation workers. */
export interface PendingRouteView {
  inputKey: string;
  original?: Segment;
  geometry: RouteGeometry;
  countryPieces?: CountryPiece[];
  waypointIds: string[];
  pending: boolean;
}
export type PendingRouteViews = Readonly<Record<string, PendingRouteView>>;

export function routingWaypointIds(segment: Segment, previous?: Segment): string[] {
  const points = segment.waypoints.filter(waypoint => waypoint.coordinates?.length === 2);
  if (!previous || segment.routingService !== previous.routingService || segment.routingProfile !== previous.routingProfile
    || segment.transportMode !== previous.transportMode) return points.map(waypoint => waypoint.id);
  const oldPoints = previous.waypoints.filter(waypoint => waypoint.coordinates?.length === 2);
  const pointKey = (waypoint: typeof points[number]) => [waypoint.id, waypoint.coordinates];
  const legKey = (a: typeof points[number], b: typeof points[number]) => JSON.stringify([pointKey(a), pointKey(b)]);
  const oldLegs = new Set(oldPoints.slice(1).map((point, index) => legKey(oldPoints[index], point)));
  const affected = new Set<string>();
  for (let i = 1; i < points.length; i++) if (!oldLegs.has(legKey(points[i - 1], points[i]))) {
    affected.add(points[i - 1].id);
    affected.add(points[i].id);
  }
  return [...affected];
}
