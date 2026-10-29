import type { Segment } from '../../../shared/types';

/** A replacement track must not carry derived values or mutate undo snapshots. */
export function importSegmentTrack(segment: Segment, coordinates: GeoJSON.Position[], adjustWaypoints: boolean): Segment {
  const updated: Segment = {
    ...segment,
    routingService: 'gpx', routingProfile: 'Imported Track', source: 'gpx',
    geometry: { type: 'LineString', coordinates },
  };
  if (adjustWaypoints && segment.waypoints.length) {
    const first = coordinates[0], last = coordinates.at(-1)!;
    updated.waypoints = segment.waypoints.map((waypoint, index) => index === 0 || index === segment.waypoints.length - 1
      ? { ...waypoint, coordinates: (index === 0 ? first : last).slice(0, 2) as [number, number] } : waypoint);
    if (updated.waypoints.length === 1) updated.waypoints.push({
      id: `wp-${crypto.randomUUID()}`, coordinates: last.slice(0, 2) as [number, number],
    });
  }
  delete updated.countryParts;
  delete updated.countryDistances;
  delete updated.distanceStats;
  delete updated.waypointDistances;
  delete updated.climateImpact;
  return updated;
}
