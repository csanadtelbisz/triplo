import { test, expect } from '@playwright/test';
import type { Trip } from '../../shared/types';
import { serializeTrip } from '../src/utils/serializeTrip';

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
