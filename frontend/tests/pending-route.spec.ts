import { test, expect } from '@playwright/test';
import type { Segment, Waypoint } from '../../shared/types';
import { routingWaypointIds } from '../src/routing/pendingRoute';

const points: Waypoint[] = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, coordinates: [i, 0] }));
const segment = (waypoints: Waypoint[], extra: Partial<Segment> = {}): Segment => ({
  id: 'route', source: 'router', transportMode: 'walk', routingService: 'test', routingProfile: 'foot', waypoints, ...extra,
});

test('an appended waypoint only marks the new leg endpoints', () => {
  expect(routingWaypointIds(segment(points), segment(points.slice(0, 3)))).toEqual(['c', 'd']);
});

test('insertions, moves, and removals mark both ends of each changed connection', () => {
  const previous = segment(points);
  const added: Waypoint = { id: 'inserted', coordinates: [1.5, 0] };
  expect(routingWaypointIds(segment([points[0], points[1], added, points[2], points[3]]), previous)).toEqual(['b', 'inserted', 'c']);
  expect(routingWaypointIds(segment([points[0], { ...points[1], coordinates: [1, 1] }, points[2], points[3]]), previous)).toEqual(['a', 'b', 'c']);
  expect(routingWaypointIds(segment([points[0], points[2], points[3]]), previous)).toEqual(['a', 'c']);
});

test('routing setting changes mark every point; metadata edits do not mark any', () => {
  const previous = segment(points);
  expect(routingWaypointIds(segment(points, { routingProfile: 'bike' }), previous)).toEqual(['a', 'b', 'c', 'd']);
  expect(routingWaypointIds(segment(points.map(point => ({ ...point, name: 'Renamed' }))), previous)).toEqual([]);
});
