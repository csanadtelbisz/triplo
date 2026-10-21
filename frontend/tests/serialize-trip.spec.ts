import { test, expect } from '@playwright/test';
import type { Trip } from '../../shared/types';
import { serializeTrip } from '../src/utils/serializeTrip';
import { computeTripCaches } from '../src/utils/distance';
import { countryPartStats } from '../src/utils/segmentGeometry';

test('trip JSON keeps readable fields and compact geometries without changing saved data', () => {
  const trip: Trip = {
    id: 'formatting', name: 'Trip "geometry": { with spaces }\nÁrvíztűrő', createdAt: '', updatedAt: '',
    segments: [{
      id: 'route', transportMode: 'bike', routingProfile: 'bike', routingService: 'manual', source: 'manual',
      geometry: { type: 'LineString', coordinates: [[16, 47, -3.5], [16.000001, 47.000001, 20]] },
      waypoints: [{ id: 'start', name: 'Keep spaces and \\slashes', coordinates: [16, 47] }],
      countryDistances: { HU: 1.2, SI: 3.4 },
    }],
    metadata: { omitted: undefined, nonfinite: NaN, empty: [], optional: [undefined, null], text: '\\n"geometry": {}' },
  };
  const before = JSON.stringify(trip);
  const serialized = serializeTrip(trip);
  expect(JSON.parse(serialized)).toEqual(JSON.parse(before));
  expect(JSON.stringify(trip)).toBe(before);
  expect(serialized.split('\n').filter(line => line.trimStart().startsWith('"geometry":'))).toEqual([
    '      "geometry": {"type":"LineString","coordinates":[[16,47,-3.5],[16.000001,47.000001,20]]},',
  ]);
  expect(serialized).toContain('      "countryDistances": {\n        "HU": 1.2,\n        "SI": 3.4\n      }');
  expect(JSON.parse(serialized).segments[0].waypoints[0].name).toBe('Keep spaces and \\slashes');
});

test('shared reference records retain standard readable JSON formatting', () => {
  const reference = { id: 'reference', name: 'Shared trip', shareLink: 'link', metadata: { isSharedTripReference: true as const } };
  expect(serializeTrip(reference)).toBe(JSON.stringify(reference, null, 2));
});

test('saved coordinates and measurements use bounded precision and compact blocks without changing runtime data', () => {
  const trip: Trip = {
    id: 'precision', name: 'Readable trip', createdAt: '', updatedAt: '',
    tripDistanceSummary: { totalDistance: 1.0359660807383146, distanceByMode: { hike: 1.0359660807383146 } },
    segments: [{
      id: 'route', transportMode: 'hike', routingProfile: 'straight', routingService: 'manual', source: 'manual',
      geometry: { type: 'LineString', coordinates: [[22.94885907773545, 40.637737416252406], [23, 41]] },
      waypoints: [{ id: 'start', coordinates: [22.94885907773545, 40.637737416252406] }, { id: 'end', coordinates: [-0.00000006, 89.99999996] }],
      distanceStats: { totalDistance: 1.0359660807383146, hasElevation: true, elevationUp: 34.11999999999999, elevationDown: 33.11999999999999 },
      waypointDistances: [
        { distanceKm: 1.0359660807383146, hasElevation: true, elevationUp: 34.11999999999999, elevationDown: 33.11999999999999 },
        { distanceKm: 0.123456789, hasElevation: false, elevationUp: 0, elevationDown: 0 },
      ],
      countryDistances: { GR: 1.0359660807383146 },
    }],
  };
  const before = JSON.stringify(trip);
  const serialized = serializeTrip(trip);
  const saved: Trip = JSON.parse(serialized);
  expect(saved.segments[0].waypoints.map(w => w.coordinates)).toEqual([[22.9488591, 40.6377374], [-0.0000001, 90]]);
  expect(saved.segments[0].geometry).toEqual(trip.segments[0].geometry);
  expect(saved.segments[0].distanceStats).toEqual({ totalDistance: 1.03597, hasElevation: true, elevationUp: 34.12, elevationDown: 33.12 });
  expect(saved.segments[0].waypointDistances).toEqual([
    { distanceKm: 1.03597, hasElevation: true, elevationUp: 34.12, elevationDown: 33.12 },
    { distanceKm: .12346, hasElevation: false },
  ]);
  expect(saved.segments[0].countryDistances).toEqual({ GR: 1.03597 });
  expect(saved.tripDistanceSummary).toEqual({ totalDistance: 1.03597, distanceByMode: { hike: 1.03597 } });
  expect(serialized).toContain('"coordinates": [22.9488591,40.6377374]');
  expect(serialized).toContain('"distanceStats": {"totalDistance":1.03597,"hasElevation":true,"elevationUp":34.12,"elevationDown":33.12}');
  expect(serialized).toContain('        {"distanceKm":1.03597,"hasElevation":true,"elevationUp":34.12,"elevationDown":33.12}');
  expect(serialized).toContain('  "name": "Readable trip",\n');
  expect(JSON.parse(serializeTrip(trip, false))).toEqual(saved);
  expect(serializeTrip(saved)).toBe(serialized);
  expect(JSON.stringify(trip)).toBe(before);
});

test('country-part stats omit unavailable elevation and still produce finite totals on reload', () => {
  const trip: Trip = { id: 'parts', name: 'Mixed elevation', createdAt: '', updatedAt: '', segments: [{
    id: 'route', transportMode: 'hike', routingProfile: 'straight', routingService: 'manual', source: 'manual', waypoints: [],
    countryParts: [
      { country: 'AA', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] }, distanceStats: { totalDistance: 1.0359660807383146, hasElevation: true, elevationUp: 34.11999999999999, elevationDown: 33.11999999999999 } },
      { country: 'BB', geometry: { type: 'LineString', coordinates: [[1, 0], [2, 0]] }, distanceStats: { totalDistance: 2.9876543, hasElevation: false, elevationUp: 0, elevationDown: 0 } },
    ],
  }] };
  const serialized = serializeTrip(trip);
  const saved: Trip = JSON.parse(serialized);
  expect(saved.segments[0].countryParts!.map(p => p.distanceStats)).toEqual([
    { totalDistance: 1.03597, hasElevation: true, elevationUp: 34.12, elevationDown: 33.12 },
    { totalDistance: 2.98765, hasElevation: false },
  ]);
  expect(serialized).toContain('"distanceStats": {"totalDistance":2.98765,"hasElevation":false}');
  expect(countryPartStats(saved.segments[0])).toEqual({ totalDistance: 4.02362, hasElevation: true, elevationUp: 34.12, elevationDown: 33.12 });
  expect(computeTripCaches(saved).segments[0].distanceStats).toEqual(countryPartStats(saved.segments[0]));
});

test('compact elevation-free caches restore zero defaults without recalculating unrelated segment distances', () => {
  const trip: Trip = { id: 'flat', name: 'Flat', createdAt: '', updatedAt: '',
    tripDistanceSummary: { totalDistance: 1, distanceByMode: { walk: 1 } },
    segments: [{ id: 'route', transportMode: 'walk', routingProfile: 'straight', routingService: 'manual', source: 'manual',
      waypoints: [], distanceStats: { totalDistance: 1, hasElevation: false, elevationUp: 0, elevationDown: 0 },
      waypointDistances: [{ distanceKm: 1, hasElevation: false, elevationUp: 0, elevationDown: 0 }],
    }],
  };
  const serialized = serializeTrip(trip);
  expect(serialized).not.toContain('elevationUp');
  expect(serialized).not.toContain('elevationDown');
  const saved: Trip = JSON.parse(serialized);
  const restored = computeTripCaches(saved, []);
  expect(restored.segments[0].distanceStats).toEqual(trip.segments[0].distanceStats);
  expect(restored.segments[0].waypointDistances).toEqual(trip.segments[0].waypointDistances);
  expect(serializeTrip(restored)).toBe(serialized);
  expect(saved.segments[0].distanceStats).not.toHaveProperty('elevationUp');
});
