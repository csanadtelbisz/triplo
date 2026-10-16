import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Trip, Segment } from '../../shared/types';

const segment = (id: string, mode: Segment['transportMode'], coordinates: number[][]): Segment => ({ id, name: id, transportMode: mode, routingService: 'manual', routingProfile: 'straight', source: 'manual', geometry: { type: 'LineString', coordinates }, waypoints: coordinates.map((c, i) => ({ id: `${id}-${i}`, coordinates: c as [number, number] })) });
const trip: Trip = { id: 'crossing', name: 'Cross-year crossing', startDate: '2024-12-31', endDate: '2025-01-02', createdAt: '', updatedAt: '', segments: [segment('drive', 'car', [[-1, 0], [1, 0], [-1, 0]]), segment('flight', 'flight', [[-1, 0.1], [1, 0.1]])] };
const countries = ['AA', 'BB'].map((code, i) => {
  const west = i ? 0 : -2, east = i ? 2 : 0;
  const geometry = { type: 'Polygon', coordinates: [[[west, -2], [east, -2], [east, 2], [west, 2], [west, -2]]] };
  const body = gzipSync(JSON.stringify({ code, territorial: geometry, land: geometry }));
  return { entry: { code, name: `Country ${i ? 'B' : 'A'}`, file: `${code}.json.gz`, sha256: createHash('sha256').update(body).digest('hex'), bounds: [[west, -2, east, 2]], landBounds: [west, -2, east, 2] }, body };
});

async function routes(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { testMap?: { getSource(id: string): { serialize(): { data: GeoJSON.FeatureCollection } } } }).testMap;
    return map?.getSource('route-source')?.serialize().data.features || [];
  });
}

test.beforeEach(async ({ page, context }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.addInitScript(() => {
    localStorage.setItem('github_token', 'test-token');
    localStorage.setItem('github_repo', 'test/trips');
    localStorage.setItem('startMinimized', 'false');
  });
  await context.route('https://api.github.com/**', route => route.fulfill({ status: route.request().url().endsWith('/contents/trips') ? 200 : 404, json: route.request().url().endsWith('/contents/trips') ? [{ name: 'crossing.triplo.json', download_url: 'https://fixtures.test/trip.json' }] : {} }));
  await context.route('https://fixtures.test/trip.json', route => route.fulfill({ json: trip }));
  await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eee' } }] } }));
  await context.route('**/countries/index.json', route => route.fulfill({ json: { version: 'fixture-1', countries: countries.map(c => c.entry), attribution: 'Test boundaries' } }));
  for (const country of countries) await context.route(`**/countries/${country.entry.file}*`, route => route.fulfill({ contentType: 'application/gzip', body: country.body }));
  await page.goto('/tests/country-app.html');
  await page.getByTitle('Analytics', { exact: true }).click();
});

test('country → mode → details supports Back/Forward and crops disconnected pieces', async ({ page }) => {
  await page.getByRole('button', { name: 'Group by country' }).click();
  await page.getByRole('button', { name: /Country A/ }).click();
  await expect(page.getByRole('button', { name: /Country B/ })).toHaveCount(0);
  await expect.poll(async () => (await routes(page)).flatMap(f => (f.geometry as GeoJSON.MultiLineString).coordinates).length).toBe(2);
  const features = await routes(page);
  expect(features.map(f => f.properties?.segmentId)).toEqual(['drive']);
  for (const line of (features[0].geometry as GeoJSON.MultiLineString).coordinates) for (const point of line) expect(point[0]).toBeLessThanOrEqual(0);
  await page.locator('.trip-summary-row').filter({ hasText: 'car' }).click();
  await page.getByTitle('Open segment info', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Analytics', exact: true, level: 2 })).toBeHidden();
  await page.goBack();
  await expect(page.getByTitle('Open segment info', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByTitle('Open segment info', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Country A/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page.getByRole('button', { name: /Country B/ })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('button', { name: /Country A/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goForward();
  await expect(page.getByTitle('Open segment info', { exact: true })).toBeVisible();
});

test('Unassigned exposes flights and slider changes replace history entries', async ({ page }) => {
  await page.getByRole('button', { name: 'Group by country' }).click();
  await page.getByRole('button', { name: /Unassigned/ }).click();
  await expect.poll(async () => (await routes(page)).map(f => f.properties?.segmentId)).toEqual(['flight']);
  await page.getByTitle('Toggle time filter', { exact: true }).click();
  const length = await page.evaluate(() => history.length);
  await page.getByRole('slider', { name: 'Analytics start date' }).press('Home');
  await page.getByRole('slider', { name: 'Analytics start date' }).press('ArrowRight');
  await page.getByRole('slider', { name: 'Analytics start date' }).press('ArrowRight');
  expect(await page.evaluate(() => history.length)).toBe(length);
  await expect(page.getByRole('button', { name: /Unassigned/ })).toContainText('74.1 km');
  await expect(page.locator('.analytics-chart')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('slider', { name: 'Analytics start date' })).toHaveValue('2');
});

test('country cropping keeps outside waypoint markers hidden after camera movement', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('renderStyleConfigs', JSON.stringify([{ id: 'all-markers', name: 'All markers', script: 'return { getSegmentStyle: () => ({hidden:false}), getWaypointStyle: () => ({hidden:false, type:"dot"}) };' }]));
    localStorage.setItem('activeRenderStyleConfigId', 'all-markers');
    window.dispatchEvent(new Event('preferences-updated'));
  });
  await page.getByRole('button', { name: 'Group by country' }).click();
  await page.getByRole('button', { name: /Country A/ }).click();
  await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
  await page.evaluate(() => {
    const map = (window as unknown as { testMap: { jumpTo(options: { center: number[]; zoom: number }): void } }).testMap;
    map.jumpTo({ center: [0, 0], zoom: 5 });
  });
  await expect(page.locator('.maplibregl-marker')).toHaveCount(1);
  for (const feature of await routes(page)) expect(feature.properties?.segmentId).toBe('drive');
});

test('failed boundary downloads show retry instead of inventing Unassigned kilometres', async ({ page, context }) => {
  await context.route('**/countries/AA.json.gz*', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot load boundaries');
  await expect(page.getByRole('button', { name: /Unassigned/ })).toHaveCount(0);
  await context.route('**/countries/AA.json.gz*', route => route.fulfill({ contentType: 'application/gzip', body: countries[0].body }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
});
