import { test, expect } from '@playwright/test';
import type { Segment, Trip } from '../../shared/types';
import { segmentClimate } from '../src/climate/profiles';
import { tripCountrySummary } from '../src/countries/summary';
import { UNASSIGNED } from '../src/countries/types';

const settings = { profiles: [], builtIn: {}, custom: [] };
const segment = (id: string, distance: number, countries: Record<string, number>): Segment => ({
  id, name: id, transportMode: 'bus', source: 'manual', routingService: 'manual', routingProfile: 'straight_line',
  waypoints: [{ id: `${id}-start`, coordinates: [19, 47] }, { id: `${id}-end`, coordinates: [20, 47] }],
  distanceStats: { totalDistance: distance, hasElevation: false, elevationUp: 0, elevationDown: 0 },
  countryDistances: countries,
});
const drive = segment('car', 100, { HU: 75, DE: 25 });
const trip: Trip = {
  id: 'summary', name: 'Summary trip', createdAt: '2026-05-01', updatedAt: '', startDate: '2026-05-01',
  tripDistanceSummary: { totalDistance: 171, distanceByMode: { bus: 171 } },
  segments: [drive,
    { ...segment('walk', 20, { HU: 20 }), transportMode: 'walk' },
    segment('unassigned', 40, { [UNASSIGNED]: 30, DE: 10 }),
    { ...segment('invalid', 11, { HU: 5, AX: 6 }), climateProfile: { mode: 'car', fuelType: 'unsupported' as never } },
    { ...segment('teleport', 999, { HU: 999 }), routingProfile: 'teleport' },
  ],
};

test('country summary aggregates distance, apportions impact, and preserves unavailable estimates', () => {
  const rows = tripCountrySummary(trip, settings);
  expect(rows.map(row => [row.code, row.distance])).toEqual([['HU', 100], ['DE', 35], ['AX', 6], [UNASSIGNED, 30]]);
  const driveKg = segmentClimate(trip, drive, settings).result!.co2eKg;
  const busKg = segmentClimate(trip, trip.segments[2], settings).result!.co2eKg;
  expect(rows[0].impact).toBeCloseTo(driveKg * .75);
  expect(rows[0].unavailable).toBe(1);
  expect(rows[1].impact).toBeCloseTo(driveKg * .25 + busKg * .25);
  expect(rows[2].impact).toBeUndefined();
  expect(rows[2].unavailable).toBe(1);
  expect(rows[3].impact).toBeCloseTo(busKg * .75);
  expect(rows.reduce((sum, row) => sum + (row.impact || 0), 0)).toBeCloseTo(driveKg + busKg);
});

test('country parts take precedence over legacy country distances, including zero-emission routes', () => {
  const walk: Segment = { ...drive, transportMode: 'walk', countryParts: [
    { country: 'AT', geometry: { type: 'LineString', coordinates: [] }, distanceStats: { ...drive.distanceStats!, totalDistance: 60 } },
    { country: 'AT', geometry: { type: 'LineString', coordinates: [] }, distanceStats: { ...drive.distanceStats!, totalDistance: 40 } },
  ] };
  expect(tripCountrySummary({ ...trip, segments: [walk] }, settings)).toEqual([
    { code: 'AT', name: 'Austria', distance: 100, impact: 0, unavailable: 0 },
  ]);
  expect(tripCountrySummary({ ...trip, segments: [] }, settings)).toEqual([]);
});

test('trip summary shows country table below modes with units and partial-estimate markers', async ({ page }) => {
  await page.addInitScript(trip => localStorage.setItem('climate-test-trip', JSON.stringify(trip)), trip);
  await page.goto('/tests/climate-app.html');
  await page.getByRole('button', { name: 'trip', exact: true }).click();
  const tables = page.locator('.trip-summary-table');
  await expect(tables).toHaveCount(2);
  await expect(tables.nth(0)).toHaveAccessibleName('Transport mode summary');
  const countries = page.getByRole('table', { name: 'Country summary', exact: true });
  await expect(countries.getByRole('columnheader')).toHaveText(['Country', 'Distance', 'Climate impact']);
  await expect(countries.getByRole('columnheader', { name: 'Distance', exact: true })).toHaveAttribute('title', 'Kilometres (km)');
  await expect(countries.getByRole('columnheader', { name: 'Climate impact', exact: true })).toHaveAttribute('title', /Kilograms CO₂e/);
  const rows = countries.locator('tbody tr');
  await expect(rows.locator('td:first-child')).toHaveText(['Hungary', 'Germany', 'Åland Islands', 'Unassigned']);
  await expect(rows.nth(0).locator('td')).toHaveText(['Hungary', '100.0', /\d+\.\d\*/]);
  await expect(rows.nth(2).locator('td')).toHaveText(['Åland Islands', '6.0', 'Unavailable']);
  await expect(rows.last().locator('td').nth(1)).toHaveText('30.0');
});

test('electric country summaries use country-specific impacts and keep unknown-country fallbacks distinct', () => {
  for (const climateProfile of [{ mode: 'rail' }, { mode: 'car', fuelType: 'bev' }, { mode: 'car', fuelType: 'phev', occupancy: 2 }] as const) {
    const train: Segment = { ...drive, transportMode: 'rail', climateProfile, countryDistances: { HU: 25, DE: 25, XX: 20, [UNASSIGNED]: 30 } };
    const total = segmentClimate(trip, train, settings).result!;
    const rows = tripCountrySummary({ ...trip, segments: [train] }, settings);
    const row = (code: string) => rows.find(row => row.code === code)!;
    expect(row('HU').impact).toBeCloseTo(total.byCountry!.HUN.co2eKg, 12);
    expect(row('DE').impact).toBeCloseTo(total.byCountry!.DEU.co2eKg, 12);
    expect(row('DE').impact).toBeGreaterThan(row('HU').impact!);
    expect(row('XX').impact).toBeCloseTo(total.byCountry!._WORLD.co2eKg * .4, 12);
    expect(row(UNASSIGNED).impact).toBeCloseTo(total.byCountry!._WORLD.co2eKg * .6, 12);
    expect(rows.reduce((sum, row) => sum + row.impact!, 0)).toBeCloseTo(total.co2eKg, 12);
  }
});
