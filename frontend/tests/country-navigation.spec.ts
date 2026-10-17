import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Trip, Segment, SegmentCountryCache } from '../../shared/types';
import type { CountryData } from '../src/countries/types';
import { segmentKey, UNASSIGNED } from '../src/countries/types';
import { attachCountryCaches } from '../src/countries/cache';

const segment = (id: string, mode: Segment['transportMode'], coordinates: number[][]): Segment => ({ id, name: id, transportMode: mode, routingService: 'manual', routingProfile: 'straight', source: 'manual', geometry: { type: 'LineString', coordinates }, waypoints: coordinates.map((c, i) => ({ id: `${id}-${i}`, coordinates: c as [number, number] })) });
const trip: Trip = { id: 'crossing', name: 'Cross-year crossing', startDate: '2024-12-31', endDate: '2025-01-02', createdAt: '', updatedAt: '', segments: [segment('drive', 'car', [[-1, 0], [1, 0], [-1, 0]]), segment('flight', 'flight', [[-1, 0.1], [1, 0.1]])] };
const countries = ['AA', 'BB'].map((code, i) => {
  const west = i ? 0 : -2, east = i ? 2 : 0;
  const geometry = { type: 'Polygon', coordinates: [[[west, -2], [east, -2], [east, 2], [west, 2], [west, -2]]] };
  const body = gzipSync(JSON.stringify({ code, territorial: geometry, land: geometry }));
  return { entry: { code, name: `Country ${i ? 'B' : 'A'}`, file: `${code}.json.gz`, sha256: createHash('sha256').update(body).digest('hex'), bounds: [[west, -2, east, 2]], landBounds: [west, -2, east, 2] }, body };
});

async function calculateCountries(page: Page, trips: Trip[]) {
  return page.evaluate(async trips => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('TriploCountryCache');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return new Promise<{ data?: CountryData; caches?: Record<string, SegmentCountryCache>; error?: string }>((resolve, reject) => {
      const worker = new Worker('/src/countries/country.worker.ts', { type: 'module' });
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      worker.postMessage({ trips, base: `${location.origin}/countries/` });
    });
  }, trips);
}

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

test('worker loads checksum-verified real boundaries and reuses existing trip results', async ({ page, context }) => {
  await context.unroute('**/countries/index.json');
  const downloads: string[] = [];
  context.on('request', request => {
    if (request.url().includes('.json.gz.bin')) downloads.push(request.url());
  });
  const distances = await page.evaluate(async () => {
    const coordinates = [[11.4, 47.26], [11.58, 48.14]];
    const trips = [{ id: 'existing', name: 'Existing trip', createdAt: '', updatedAt: '', segments: Array.from({ length: 100 }, (_, segmentIndex) => {
      const route = coordinates.map(([lon, lat]) => [lon + segmentIndex * 0.0001, lat]);
      return {
        id: `crossing-${segmentIndex}`, transportMode: 'car', routingProfile: 'car', source: 'manual', routingService: 'manual',
        geometry: { type: 'LineString', coordinates: route },
        waypoints: route.map((coordinates, i) => ({ id: `w${i}`, coordinates })),
      };
    }) }];
    const calculate = () => new Promise<Record<string, number>>((resolve, reject) => {
      const worker = new Worker('/src/countries/country.worker.ts', { type: 'module' });
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = event => {
        worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(Object.values(event.data.data.results as Record<string, { distanceKmByCountry: Record<string, number> }>)[0].distanceKmByCountry);
      };
      worker.postMessage({ trips, base: `${location.origin}/countries/` });
    });
    return [await calculate(), await calculate()];
  });
  expect(distances[0].AT).toBeGreaterThan(0);
  expect(distances[0].DE).toBeGreaterThan(0);
  expect(distances[1]).toEqual(distances[0]);
  expect(downloads.length).toBeGreaterThan(0);
  expect(new Set(downloads).size).toBe(downloads.length);
});

test('trip JSON caches work in an empty browser cache and reject stale versions and routes', async ({ page, context }) => {
  const first = await calculateCountries(page, [trip]);
  expect(first.error).toBeUndefined();
  const saved: Trip[] = JSON.parse(JSON.stringify(attachCountryCaches([trip], first.caches!)));
  const drive = saved[0].segments[0].countryCache!;
  expect(drive.result.pieces.filter(piece => piece.country === 'AA')).toHaveLength(2);
  expect(saved[0].segments[1].countryCache!.result.shares[UNASSIGNED]).toBe(1);
  for (const country of countries) await context.route(`**/countries/${country.entry.file}*`, route => route.fulfill({ status: 503 }));
  const restored = await calculateCountries(page, saved);
  expect(restored.error).toBeUndefined();
  expect(restored.data).toEqual(first.data);
  const dated = structuredClone(saved);
  dated[0].startDate = '2000-01-01';
  dated[0].name = 'Renamed trip';
  expect((await calculateCountries(page, dated)).data).toEqual(first.data);
  for (const property of ['boundaryVersion', 'algorithmVersion', 'geometryVersion', 'inputHash'] as const) {
    const stale = structuredClone(saved);
    const cache = stale[0].segments[0].countryCache!;
    if (property === 'boundaryVersion' || property === 'inputHash') cache[property] = 'outdated';
    else cache[property] += 1;
    expect((await calculateCountries(page, stale)).error, property).toContain('Cannot load boundaries');
  }
  const moved = structuredClone(saved);
  moved[0].segments[0].geometry.coordinates[1][0] = 0.5;
  expect((await calculateCountries(page, moved)).error).toContain('Cannot load boundaries');
  const movedWaypoint = structuredClone(saved);
  movedWaypoint[0].segments[0].waypoints[0].coordinates[0] = -0.5;
  expect((await calculateCountries(page, movedWaypoint)).error).toContain('Cannot load boundaries');
  const flight = structuredClone(saved);
  flight[0].segments[0].transportMode = 'flight';
  const flown = await calculateCountries(page, flight);
  expect(flown.data!.results[segmentKey(trip.id, 'drive')].shares[UNASSIGNED]).toBeCloseTo(1, 9);
});

for (const saveAll of [false, true]) test(`${saveAll ? 'Save All' : 'Save'} writes country caches into segment JSON without an undo step`, async ({ page, context }) => {
  let saved: Trip | undefined;
  await context.route('https://api.github.com/repos/test/trips/contents/trips/**', async route => {
    if (route.request().method() === 'PUT') {
      saved = JSON.parse(Buffer.from(route.request().postDataJSON().content, 'base64').toString('utf8'));
      await route.fulfill({ status: 200, json: { content: { sha: 'saved' } } });
    } else await route.fulfill({ status: 404, json: {} });
  });
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
  await page.getByTitle('Close Analytics', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Group by country' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByTitle('Close Analytics', { exact: true }).click();
  if (!saveAll) {
    await page.locator('.trip-card').filter({ hasText: trip.name }).click();
    await expect(page.getByTitle('Undo', { exact: true })).toBeDisabled();
  }
  await page.getByTitle(saveAll ? 'Save All Unsaved Trips' : 'Save', { exact: true }).click();
  await expect.poll(() => saved?.segments.length).toBe(2);
  for (const segment of saved!.segments) {
    expect(segment.countryCache!.boundaryVersion).toBe('fixture-1');
    expect(segment.countryCache!.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(segment.countryCache!.result.totalDistanceKm).toBeCloseTo(segment.distanceStats!.totalDistance, 8);
  }
  expect(saved!.segments[0].countryCache!.result.distanceKmByCountry.AA).toBeGreaterThan(0);
  expect(saved!.segments[1].countryCache!.result.shares[UNASSIGNED]).toBe(1);
  await expect(page.getByTitle(saveAll ? 'Save All Unsaved Trips' : 'Save', { exact: true })).toHaveCount(0);
  if (!saveAll) {
    await page.getByTitle('Segment Info', { exact: true }).first().click();
    await page.getByTitle('Flight', { exact: true }).click();
    await page.goBack();
    await expect(page.getByTitle('Undo', { exact: true })).toBeEnabled();
    await page.getByTitle('Save', { exact: true }).click();
    await expect.poll(() => saved!.segments[0].transportMode).toBe('flight');
    expect(saved!.segments[0].countryCache).toBeUndefined();
    expect(saved!.segments[1].countryCache).toBeDefined();
  }
});

test('shared trip references never acquire or write country cache geometry', async ({ page }) => {
  const shared = { ...trip, metadata: { isSharedTripReference: true } };
  const computed = await calculateCountries(page, [shared]);
  expect(computed.error).toBeUndefined();
  expect(computed.caches).toEqual({});
  const owned = await calculateCountries(page, [trip]);
  const sharedTrips = [shared];
  expect(attachCountryCaches(sharedTrips, owned.caches!)).toBe(sharedTrips);
});

test('providers differing only in country caches do not create sync conflicts', async ({ page }) => {
  const computed = await calculateCountries(page, [trip]);
  const cached = attachCountryCaches([trip], computed.caches!)[0];
  await page.evaluate(async ({ original, cached }) => {
    const { persistingManager } = await import('/src/persisting/PersistingManager.ts');
    persistingManager.loadAllTrips = async () => [
      { ...original, updatedAt: '2025-01-01', metadata: { _sourceService: 'Google Drive' } },
      { ...cached, updatedAt: '2025-01-02', metadata: { _sourceService: 'GitHub' } },
    ];
  }, { original: trip, cached });
  await page.getByTitle('Close Analytics', { exact: true }).click();
  await page.getByTitle('Reload from all services', { exact: true }).click();
  await expect(page.getByTitle('Reload from all services', { exact: true })).toBeEnabled();
  await expect(page.getByTitle('Conflicts found between devices/services', { exact: true })).toHaveCount(0);
  await expect(page.getByTitle('Sync conflicts or missing trips', { exact: true })).toHaveCount(0);
});
