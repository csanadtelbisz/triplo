import { test, expect } from '@playwright/test';
import type { Segment, Trip } from '../../shared/types';
import type { Page } from '@playwright/test';
import { groupAnalyticsBy } from './analytics-test-helpers';
import { emptyAnalyticsSelection, matchesAnalyticsSegment, selectedClimate } from '../src/countries/analytics';

const segment = (id: string, mode: Segment['transportMode'], km: number, countries: Record<string, number>, emitting = true): Segment => ({
  id, name: id, transportMode: mode, routingProfile: 'straight', source: 'manual', waypoints: [], countryDistances: countries,
  distanceStats: { totalDistance: km, elevationUp: 0, elevationDown: 0, hasElevation: false },
  climateProfile: emitting ? { mode: 'bus', busType: 'coach' } : { mode: 'none' },
});
const trip = (id: string, name: string, segments: Segment[]): Trip => ({ id, name, segments, startDate: '2026-05-01', endDate: '2026-05-01', createdAt: '', updatedAt: '' });
const first = trip('first', 'Cross-border trip', [segment('drive', 'car', 100, { HU: 60, DE: 40 }), segment('bus', 'bus', 50, { DE: 50 }), segment('zero-car', 'car', 30, { FR: 30 }, false)]);
const second = trip('second', 'Second trip', [segment('coach', 'bus', 40, { HU: 40 }), segment('walk', 'walk', 300, { HU: 300 }, false)]);
const walking = trip('walk', 'Walking trip', [segment('long-walk', 'walk', 500, { DE: 500 }, false)]);

async function open(page: Page, climate = false, displayed: Trip = first) {
  await page.addInitScript(({ first, additional }) => {
    localStorage.setItem('climate-test-trip', JSON.stringify(first));
    localStorage.setItem('climate-test-additional-trips', JSON.stringify(additional));
  }, { first: displayed, additional: [second, walking] });
  await page.goto('/tests/climate-app.html');
  await page.getByRole('button', { name: 'analytics', exact: true }).click();
  if (climate) await page.getByRole('button', { name: 'Show climate impact', exact: true }).click();
}

test('shared filters combine trip, country, mode, date and actual emitting segments', () => {
  const filters = { ...emptyAnalyticsSelection, trip: 'first', country: 'HU', mode: 'car', climate: true };
  expect(matchesAnalyticsSegment(first, first.segments[0], filters, undefined, 4.604)).toBe(true);
  expect(matchesAnalyticsSegment(first, first.segments[0], filters, undefined, 0)).toBe(false);
  expect(matchesAnalyticsSegment(first, first.segments[0], filters, undefined, undefined)).toBe(false);
  expect(matchesAnalyticsSegment(second, second.segments[0], filters, undefined, 1.8416)).toBe(false);
  expect(matchesAnalyticsSegment(first, first.segments[1], filters, undefined, 2.302)).toBe(false);
  expect(matchesAnalyticsSegment(first, first.segments[0], { ...filters, range: [Date.parse('2025-01-01'), Date.parse('2025-12-31')] }, undefined, 4.604)).toBe(false);
  expect(selectedClimate(first, first.segments[0], 4.604, 'HU')).toBeCloseTo(2.7624, 10);
  expect(selectedClimate(first, first.segments[0], 4.604, 'DE')).toBeCloseTo(1.8416, 10);
});

for (const climate of [false, true]) test(`trip, country and transport filters intersect in ${climate ? 'climate' : 'distance'} mode`, async ({ page }) => {
  await open(page, climate);
  await groupAnalyticsBy(page, 'trips');
  const trips = page.getByLabel(climate ? 'Trip climate impacts' : 'Trip distances', { exact: true });
  await expect(trips.locator('.analytics-summary-row')).toHaveCount(climate ? 2 : 3);
  await expect(trips.locator('.analytics-summary-row').first()).toContainText(climate ? 'Cross-border trip' : 'Walking trip');
  await trips.getByRole('button', { name: /Cross-border trip/ }).click();
  await expect(page.getByLabel('Trip comparison', { exact: true })).toHaveCount(0);
  const countries = page.getByLabel('Countries', { exact: true });
  const modes = page.getByLabel('Transport modes', { exact: true });
  await expect(countries.locator('.country-row')).toHaveCount(climate ? 2 : 3);
  await expect(modes.getByRole('button', { name: /car/i })).toContainText(climate ? '4.6' : '130.0');
  await modes.getByRole('button', { name: /bus/i }).click();
  await expect(countries.locator('.country-row')).toHaveCount(1);
  await expect(countries.locator('.country-row')).toContainText('DE');
  await countries.getByRole('button', { name: /DE/ }).click();
  await expect(modes.getByRole('button', { name: /bus/i })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear transport mode filter', exact: true }).click();
  await expect(modes.getByRole('button', { name: /car/i })).toContainText(climate ? '1.8' : '40.0');
  await expect(modes.getByRole('button', { name: /bus/i })).toContainText(climate ? '2.3' : '50.0');
  await page.getByRole('button', { name: climate ? 'Show distance' : 'Show climate impact', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clear trip filter', exact: true })).toBeVisible();
  await expect(countries.getByRole('button', { name: /DE/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear country filter', exact: true }).click();
  await expect(countries.locator('.country-row')).toHaveCount(climate ? 3 : 2);
  await page.getByRole('button', { name: 'Clear trip filter', exact: true }).click();
  await expect(page.getByLabel('Trip comparison', { exact: true })).toBeVisible();
});

test('the three-state grouping works for both metrics and country climate totals reconcile', async ({ page }) => {
  await open(page);
  for (const climate of [false, true]) {
    const grouping = page.locator('[data-analytics-grouping]');
    for (const [group, icon] of [['modes', 'commute'], ['trips', 'route'], ['countries', 'public']] as const) {
      await groupAnalyticsBy(page, group);
      await expect(grouping).toHaveText(icon);
    }
    if (!climate) await page.getByRole('button', { name: 'Show climate impact', exact: true }).click();
  }
  const countries = page.getByLabel('Countries', { exact: true });
  await expect(countries.locator('.country-row')).toHaveCount(2);
  await expect(countries.getByRole('button', { name: /HU/ })).toContainText('4.6');
  await expect(countries.getByRole('button', { name: /DE/ })).toContainText('4.1');
  await countries.getByRole('button', { name: /HU/ }).click();
  await expect(page.getByLabel('Transport modes', { exact: true })).toContainText('2.8');
  await expect(page.getByLabel('Transport modes', { exact: true })).toContainText('1.8');
});

test('scatter supports mouse, keyboard and finger scrubbing with a fixed trip-name readout', async ({ page, context }) => {
  await open(page);
  await groupAnalyticsBy(page, 'trips');
  const chart = page.getByRole('group', { name: 'Trips by distance and climate impact', exact: true });
  await chart.scrollIntoViewIfNeeded();
  const a = chart.locator('[data-trip-id="first"]'), b = chart.locator('[data-trip-id="second"]');
  const readout = page.locator('.trip-scatter-readout');
  const before = await readout.boundingBox();
  const center = async (point: typeof a) => { const box = (await point.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const pa = await center(a), pb = await center(b);
  await page.mouse.move(pa.x, pa.y);
  await expect(readout).toContainText('Cross-border trip');
  await expect(a).toHaveClass(/active/);
  await page.mouse.move(pb.x, pb.y);
  await expect(readout).toContainText('Second trip');
  expect(await readout.boundingBox()).toEqual(before);
  await a.focus();
  await expect(readout).toContainText('Cross-border trip');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pa.x, y: pa.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pb.x, y: pb.y }] });
  await expect(readout).toContainText('Second trip');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(readout).toContainText('Second trip');
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/triplo-analytics-trip-view.png', fullPage: true });
});


test('scatter omits trips with incomplete climate estimates in either metric', async ({ page }) => {
  const invalid: Segment = { ...segment('bad-profile', 'car', 10, { HU: 10 }), climateProfile: { mode: 'car', fuelType: 'unsupported' as never } };
  await open(page, false, { ...first, segments: [...first.segments, invalid] });
  await groupAnalyticsBy(page, 'trips');
  await expect(page.getByRole('status')).toContainText('1 unavailable');
  await expect(page.locator('.trip-scatter-point')).toHaveCount(2);
  await expect(page.locator('.trip-scatter-point[data-trip-id="first"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show climate impact', exact: true }).click();
  await expect(page.getByLabel('Trip climate impacts', { exact: true })).toContainText('Cross-border trip');
  await expect(page.locator('.trip-scatter-point')).toHaveCount(1);
  await expect(page.locator('.trip-scatter-point')).toHaveAttribute('data-trip-id', 'second');
});
