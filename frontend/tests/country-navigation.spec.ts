import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { Trip, Segment } from '../../shared/types';
import type { CountryData } from '../src/countries/types';
import { segmentKey, UNASSIGNED } from '../src/countries/types';
import { attachCountryDistances } from '../src/countries/cache';
import { computeTripCaches } from '../src/utils/distance';
import { encodeSharePayload } from '../src/utils/shareLinkEncoding';

const segment = (id: string, mode: Segment['transportMode'], coordinates: number[][]): Segment => ({ id, name: id, transportMode: mode, routingService: 'manual', routingProfile: 'straight', source: 'manual', geometry: { type: 'LineString', coordinates }, waypoints: coordinates.map((c, i) => ({ id: `${id}-${i}`, coordinates: c as [number, number] })) });
const trip: Trip = { id: 'crossing', name: 'Cross-year crossing', startDate: '2024-12-31', endDate: '2025-01-02', createdAt: '', updatedAt: '', segments: [segment('drive', 'car', [[-1, 0], [1, 0], [-1, 0]]), segment('flight', 'flight', [[-1, 0.1], [1, 0.1]])] };
const countries = ['AA', 'BB'].map((code, i) => {
  const west = i ? 0 : -2, east = i ? 2 : 0;
  const geometry = { type: 'Polygon', coordinates: [[[west, -2], [east, -2], [east, 2], [west, 2], [west, -2]]] };
  const body = gzipSync(JSON.stringify({ code, territorial: geometry, land: geometry }));
  return { entry: { code, name: `Country ${i ? 'B' : 'A'}`, file: `${code}.json.gz`, sha256: createHash('sha256').update(body).digest('hex'), bounds: [[west, -2, east, 2]], landBounds: [west, -2, east, 2] }, body };
});

async function calculateCountries(page: Page, trips: Trip[], country: string | null = null) {
  return page.evaluate(async ({ trips, country }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('TriploCountryCache');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return new Promise<{ data?: CountryData; distances?: Record<string, Record<string, number>>; error?: string }>((resolve, reject) => {
      const worker = new Worker('/src/countries/country.worker.ts', { type: 'module' });
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = event => { if (!event.data.complete) return; worker.terminate(); resolve(event.data); };
      worker.postMessage({ trips, country, base: `${location.origin}/countries/` });
    });
  }, { trips, country });
}

async function routes(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { testMap?: { getSource(id: string): { serialize(): { data: GeoJSON.FeatureCollection } } } }).testMap;
    return map?.getSource('route-source')?.serialize().data.features || [];
  });
}

async function cachedTrips(page: Page): Promise<Trip[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('TriploDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('trips').objectStore('trips').get('triplo_cached_trips_v2');
      read.onsuccess = () => { resolve(read.result || []); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }));
}

async function clearDatabases(page: Page, names: string[]) {
  await page.evaluate(async names => {
    for (const name of names) await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error(`Database still open: ${name}`));
    });
  }, names);
}

test.beforeEach(async ({ page, context }) => {
  page.on('dialog', dialog => dialog.accept());
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
  await expect(page.getByRole('button', { name: /Unassigned/ })).toContainText('74.1');
  await expect(page.locator('.analytics-chart')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('slider', { name: 'Analytics start date' })).toHaveValue('2');
});

test('clearing a country returns to the list and Back leaves Analytics without reactivating it', async ({ page }) => {
  await page.getByRole('button', { name: 'Group by country' }).click();
  await page.getByRole('button', { name: /Country A/ }).click();
  await page.getByRole('button', { name: /Country A/ }).click();
  await expect(page.getByRole('button', { name: /Country B/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByTitle('Analytics', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('button', { name: /Country B/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Country A/ })).toHaveAttribute('aria-pressed', 'false');
  await page.goForward();
  await expect(page.getByRole('button', { name: /Country A/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Country A/ }).click();
  await page.getByRole('button', { name: /Country B/ }).click();
  await page.goBack();
  await expect(page.getByRole('button', { name: /Country A/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /Country B/ })).toHaveAttribute('aria-pressed', 'false');
  await page.goBack();
  await expect(page.getByTitle('Analytics', { exact: true })).toBeVisible();
});

test('clearing a transport selection skips the old mode on Back', async ({ page }) => {
  const car = page.locator('.analytics-summary-row').filter({ hasText: 'car' });
  await car.click();
  await expect(page.getByTitle('Open segment info', { exact: true })).toBeVisible();
  await car.click();
  await expect(page.getByTitle('Open segment info', { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTitle('Analytics', { exact: true })).toBeVisible();
});

test('country and mode deselection, view toggles, and panel arrows preserve logical parents', async ({ page }) => {
  const globe = page.getByRole('button', { name: 'Group by country' });
  await globe.click();
  await page.getByRole('button', { name: /Country A/ }).click();
  const car = page.locator('.analytics-summary-row').filter({ hasText: 'car' });
  await car.click();
  await car.click();
  await expect(page.getByTitle('Open segment info', { exact: true })).toHaveCount(0);
  await page.getByTitle('Close Analytics', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Country B/ })).toBeVisible();
  await globe.click();
  await globe.click();
  await globe.click();
  await page.goBack();
  await expect(page.getByTitle('Analytics', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(globe).toHaveAttribute('aria-pressed', 'false');
  await globe.click();
  await page.getByRole('button', { name: /Country B/ }).click();
  await globe.click();
  await expect(globe).toHaveAttribute('aria-pressed', 'false');
  await page.getByTitle('Close Analytics', { exact: true }).click();
  await expect(page.getByTitle('Analytics', { exact: true })).toBeVisible();
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
  await page.goto('/tests/map-distance.html');
  await page.evaluate(async () => {
    for (const name of ['TriploDB', 'TriploCountryCache']) await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  await page.goto('/tests/country-app.html');
  await page.getByTitle('Analytics', { exact: true }).click();
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot load boundaries');
  await expect(page.getByRole('button', { name: /Unassigned/ })).toHaveCount(0);
  await context.route('**/countries/AA.json.gz*', route => route.fulfill({ contentType: 'application/gzip', body: countries[0].body }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
});

test('worker loads checksum-verified real boundaries and reuses existing trip results', async ({ page, context }) => {
  test.setTimeout(60000);
  await context.unroute('**/countries/index.json');
  const downloads: string[] = [];
  context.on('request', request => {
    if (request.url().includes('.json.gz.bin')) downloads.push(request.url());
  });
  const distances = await page.evaluate(async () => {
    const coordinates = Array.from({ length: 10 }, (_, i) => [11.4 + 0.18 * i / 9, 47.26 + 0.88 * i / 9]);
    const trips = [{ id: 'existing', name: 'Existing trip', createdAt: '', updatedAt: '', segments: Array.from({ length: 100 }, (_, segmentIndex) => {
      const route = coordinates.map(([lon, lat]) => [lon + segmentIndex * 0.0001, lat]);
      return {
        id: `crossing-${segmentIndex}`, transportMode: 'car', routingProfile: 'car', source: 'manual', routingService: 'manual',
        geometry: { type: 'LineString', coordinates: route },
        waypoints: [route[0], route.at(-1)!].map((coordinates, i) => ({ id: `w${i}`, coordinates })),
      };
    }) }];
    let availableProgress = 0;
    const calculate = () => new Promise<Record<string, number>>((resolve, reject) => {
      const worker = new Worker('/src/countries/country.worker.ts', { type: 'module' });
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = event => {
        if (!event.data.complete) {
          if (Object.keys(event.data.data?.results || {}).length) availableProgress++;
          return;
        }
        worker.terminate();
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(Object.values(event.data.data.results as Record<string, { distanceKmByCountry: Record<string, number> }>)[0].distanceKmByCountry);
      };
      worker.postMessage({ trips, base: `${location.origin}/countries/` });
    });
    const first = await calculate();
    const second = await calculate();
    return { distances: [first, second], availableProgress };
  });
  expect(distances.distances[0].AT).toBeGreaterThan(0);
  expect(distances.distances[0].DE).toBeGreaterThan(0);
  expect(distances.distances[1]).toEqual(distances.distances[0]);
  expect(distances.availableProgress).toBeGreaterThan(0);
  expect(downloads.length).toBeGreaterThan(0);
  expect(new Set(downloads).size).toBe(downloads.length);
});

test('trip JSON contains only country distance maps; clipped routes stay browser-local', async ({ page, context }) => {
  const first = await calculateCountries(page, [trip]);
  expect(first.error).toBeUndefined();
  const saved: Trip[] = JSON.parse(JSON.stringify(attachCountryDistances([trip], first.distances!)));
  expect(first.data!.results[segmentKey(trip.id, 'drive')].pieces.filter(piece => piece.country === 'AA')).toHaveLength(2);
  expect(saved[0].segments[0].countryDistances).toEqual(first.data!.results[segmentKey(trip.id, 'drive')].distanceKmByCountry);
  expect(Object.keys(saved[0].segments[0]).filter(key => !(key in trip.segments[0]))).toEqual(['countryDistances']);
  expect(saved[0].segments[1].countryDistances![UNASSIGNED]).toBeGreaterThan(0);
  for (const country of countries) await context.route(`**/countries/${country.entry.file}*`, route => route.fulfill({ status: 503 }));
  const restored = await calculateCountries(page, saved);
  expect(restored.error).toBeUndefined();
  expect(restored.data!.results[segmentKey(trip.id, 'drive')].distanceKmByCountry).toEqual(saved[0].segments[0].countryDistances);
  expect(restored.data!.results[segmentKey(trip.id, 'drive')].pieces).toEqual([]);
  expect(restored.data!.results[segmentKey(trip.id, 'drive')].geometryReady).toBe(false);
  const dated = structuredClone(saved);
  dated[0].startDate = '2000-01-01';
  dated[0].name = 'Renamed trip';
  expect((await calculateCountries(page, dated)).data).toEqual(restored.data);
  expect((await calculateCountries(page, saved, 'AA')).error).toContain('Cannot load boundaries');
  const moved = structuredClone(saved);
  moved[0].segments[0].geometry.coordinates[1][0] = 0.5;
  delete moved[0].segments[0].countryDistances;
  expect((await calculateCountries(page, moved)).error).toContain('Cannot load boundaries');
  const movedWaypoint = structuredClone(saved);
  movedWaypoint[0].segments[0].waypoints[0].coordinates[0] = -0.5;
  delete movedWaypoint[0].segments[0].countryDistances;
  expect((await calculateCountries(page, movedWaypoint)).error).toContain('Cannot load boundaries');
  const flight = structuredClone(saved);
  flight[0].segments[0].transportMode = 'flight';
  delete flight[0].segments[0].countryDistances;
  const flown = await calculateCountries(page, flight);
  expect(flown.data!.results[segmentKey(trip.id, 'drive')].shares[UNASSIGNED]).toBeCloseTo(1, 9);
  for (const country of countries) await context.route(`**/countries/${country.entry.file}*`, route => route.fulfill({ contentType: 'application/gzip', body: country.body }));
  const clipped = await calculateCountries(page, saved, 'AA');
  expect(clipped.error).toBeUndefined();
  expect(clipped.data!.results[segmentKey(trip.id, 'drive')].pieces.filter(piece => piece.country === 'AA')).toHaveLength(2);
});

test('saved distance maps need no boundaries until a cold browser crops a country', async ({ page, context }) => {
  const calculated = await calculateCountries(page, [trip]);
  const saved = attachCountryDistances([trip], calculated.distances!)[0];
  await context.route('https://fixtures.test/trip.json', route => route.fulfill({ json: saved }));
  await page.goto('/tests/map-distance.html');
  await clearDatabases(page, ['TriploDB', 'TriploCountryCache']);
  const downloads: string[] = [];
  for (const country of countries) await context.route(`**/countries/${country.entry.file}*`, route => {
    downloads.push(country.entry.code);
    return route.fulfill({ contentType: 'application/gzip', body: country.body });
  });
  await page.goto('/tests/country-app.html');
  await page.getByTitle('Analytics', { exact: true }).click();
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(downloads).toEqual([]);
  await page.getByRole('button', { name: /Country A/ }).click();
  await expect.poll(async () => (await routes(page)).flatMap(feature => (feature.geometry as GeoJSON.MultiLineString).coordinates).length).toBe(2);
  expect(downloads.sort()).toEqual(['AA', 'BB']);
  for (const feature of await routes(page)) {
    expect(feature.properties?.segmentId).toBe('drive');
    for (const line of (feature.geometry as GeoJSON.MultiLineString).coordinates) for (const point of line) expect(point[0]).toBeLessThanOrEqual(0);
  }
});

for (const saveAll of [false, true]) test(`${saveAll ? 'Save All' : 'Save'} writes only country distance maps into segment JSON without an undo step`, async ({ page, context }) => {
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
  await expect(page.getByTitle('Analytics', { exact: true })).toBeVisible();
  if (!saveAll) {
    await page.locator('.trip-card').filter({ hasText: trip.name }).click();
    await expect(page.getByTitle('Undo', { exact: true })).toBeDisabled();
  }
  await page.getByTitle(saveAll ? 'Save All Unsaved Trips' : 'Save', { exact: true }).click();
  await expect.poll(() => saved?.segments.length).toBe(2);
  for (const segment of saved!.segments) {
    expect(Object.values(segment.countryDistances!).reduce((sum, distance) => sum + distance, 0)).toBeCloseTo(segment.distanceStats!.totalDistance, 8);
    expect(segment).not.toHaveProperty('countryCache');
    expect(segment.distanceStats).not.toHaveProperty('geometryVersion');
  }
  expect(saved!.segments[0].countryDistances!.AA).toBeGreaterThan(0);
  expect(saved!.segments[1].countryDistances![UNASSIGNED]).toBeGreaterThan(0);
  await expect(page.getByTitle(saveAll ? 'Save All Unsaved Trips' : 'Save', { exact: true })).toHaveCount(0);
  if (!saveAll) {
    await page.getByTitle('Segment Info', { exact: true }).first().click();
    await page.getByTitle('Flight', { exact: true }).click();
    await page.goBack();
    await expect(page.getByTitle('Undo', { exact: true })).toBeEnabled();
    await expect.poll(async () => (await cachedTrips(page))[0]?.segments[0].countryDistances?.[UNASSIGNED]).toBeDefined();
    await page.getByTitle('Save', { exact: true }).click();
    await expect.poll(() => saved!.segments[0].transportMode).toBe('flight');
    await expect.poll(() => saved!.segments[0].countryDistances?.[UNASSIGNED]).toBeDefined();
    expect(saved!.segments[1].countryDistances).toBeDefined();
  }
});

for (const shared of [false, true]) test(`country caches remain unsaved across refresh until saved for ${shared ? 'owned shared' : 'owned'} trips`, async ({ page, context }) => {
  test.setTimeout(60000);
  const shareLink = encodeSharePayload({ service: 'GitHub', data: 'owned-share' });
  let remote: Trip = { ...trip, id: shared ? 'owned-shared' : 'owned', metadata: shared ? { sharedService: 'GitHub', shareLink } : undefined };
  let writes = 0;
  await context.route('https://fixtures.test/trip.json', route => route.fulfill({ json: remote }));
  await context.route('https://api.github.com/repos/test/trips/contents/trips/**', async route => {
    if (route.request().method() === 'PUT') {
      remote = JSON.parse(Buffer.from(route.request().postDataJSON().content, 'base64').toString('utf8'));
      writes++;
      await route.fulfill({ json: { content: { sha: 'saved' } } });
    } else await route.fulfill({ status: 404, json: {} });
  });
  await context.route('https://api.github.com/gists/owned-share', route => route.fulfill({ json: {} }));
  await page.goto('/tests/country-app.html');
  await page.getByTitle('Analytics', { exact: true }).click();
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByTitle('Close Analytics', { exact: true }).click();
  await expect(page.getByTitle('Unsaved changes', { exact: true })).toBeVisible();
  await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await expect.poll(async () => (await cachedTrips(page)).find(trip => trip.id === remote.id)?.segments.every(segment => !!segment.countryDistances)).toBe(true);
  await clearDatabases(page, ['TriploCountryCache']);
  for (const country of countries) await context.route(`**/countries/${country.entry.file}*`, route => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(page.getByTitle('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByTitle('Analytics', { exact: true }).click();
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByTitle('Close Analytics', { exact: true }).click();
  await page.getByTitle('Save All Unsaved Trips', { exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  expect(remote.segments.every(segment => !!segment.countryDistances)).toBe(true);
  await expect(page.getByTitle('Unsaved changes', { exact: true })).toHaveCount(0);
  await page.goto('/tests/map-distance.html');
  await clearDatabases(page, ['TriploDB', 'TriploCountryCache']);
  await page.goto('/tests/country-app.html');
  await expect(page.getByTitle('Reload from all services', { exact: true })).toBeEnabled();
  await expect(page.getByTitle('Unsaved changes', { exact: true })).toHaveCount(0);
  await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toHaveCount(0);
  await page.getByTitle('Analytics', { exact: true }).click();
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTitle('Reload from all services', { exact: true })).toBeEnabled();
  await expect(page.getByTitle('Unsaved changes', { exact: true })).toHaveCount(0);
  await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toHaveCount(0);
});

test('public shared views produce country results without writable caches', async ({ page, context }) => {
  const external = { ...trip, id: 'external', name: 'External trip', metadata: { sharedService: 'GitHub' } };
  const shareLink = encodeSharePayload({ service: 'GitHub', data: 'external-share' });
  await context.route('https://api.github.com/gists/external-share', route => route.fulfill({ json: { files: { 'external.triplo.json': { content: JSON.stringify(external) } } } }));
  await page.addInitScript(() => {
    const state = window as any;
    state.countryUpdates = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('country.worker')) this.addEventListener('message', event => {
          state.countryUpdates.push({ results: Object.keys(event.data.data?.results || {}), distances: Object.keys(event.data.distances || {}) });
        });
      }
    };
  });
  await page.goto(`/share/${shareLink}`);
  const key = segmentKey(external.id, 'drive');
  await expect.poll(() => page.evaluate(key => (window as any).countryUpdates.some((update: any) => update.results.includes(key)), key)).toBe(true);
  const caches = await page.evaluate(() => (window as any).countryUpdates.flatMap((update: any) => update.distances));
  expect(caches).not.toContain(key);
  expect((await cachedTrips(page)).map(trip => trip.id)).not.toContain(external.id);
});

test('shared trip references never acquire or write country cache geometry', async ({ page }) => {
  const shared = { ...trip, metadata: { isSharedTripReference: true } };
  const computed = await calculateCountries(page, [shared]);
  expect(computed.error).toBeUndefined();
  expect(computed.distances).toEqual({});
  const owned = await calculateCountries(page, [trip]);
  const sharedTrips = [shared];
  expect(attachCountryDistances(sharedTrips, owned.distances!)).toBe(sharedTrips);
});

test('providers differing only in country caches do not create sync conflicts', async ({ page }) => {
  const computed = await calculateCountries(page, [trip]);
  const cached = computeTripCaches(attachCountryDistances([trip], computed.distances!)[0]);
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
  const edited = structuredClone(trip);
  edited.segments[0].geometry.coordinates[1] = [0.5, 0];
  await page.evaluate(async ({ edited, cached }) => {
    const { persistingManager } = await import('/src/persisting/PersistingManager.ts');
    persistingManager.loadAllTrips = async () => [
      { ...edited, metadata: { _sourceService: 'Google Drive' } },
      { ...cached, metadata: { _sourceService: 'GitHub' } },
    ];
  }, { edited, cached });
  await page.getByTitle('Reload from all services', { exact: true }).click();
  await expect(page.getByTitle('Conflicts found between devices/services', { exact: true })).toHaveCount(1);
});

for (const changeRoute of [false, true]) test(changeRoute ? 'routing changes replace a running country calculation while Analytics is closed' : 'country rows update every 500 ms while another trip is calculating without restarting the worker', async ({ page, context }) => {
  const ready: Trip = { ...trip, id: 'ready', name: 'Ready flight', segments: [segment('ready-flight', 'flight', [[-1, 0], [1, 0]])] };
  const pending: Trip = { ...trip, id: 'pending', name: 'Pending route', segments: [segment('pending-drive', 'car', [[-1, 0], [1, 0]])] };
  await context.route('https://api.github.com/repos/test/trips/contents/trips', route => route.fulfill({ json: [
    { name: 'ready.triplo.json', download_url: 'https://fixtures.test/ready.json' },
    { name: 'pending.triplo.json', download_url: 'https://fixtures.test/pending.json' },
  ] }));
  await context.route('https://fixtures.test/ready.json', route => route.fulfill({ json: ready }));
  await context.route('https://fixtures.test/pending.json', route => route.fulfill({ json: pending }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/countries/AA.json.gz*', async route => {
    await gate;
    await route.fulfill({ contentType: 'application/gzip', body: countries[0].body });
  });
  await page.addInitScript(() => {
    const state = window as unknown as { countryWorkerCount: number; countryProgressTimes: number[] };
    state.countryWorkerCount = 0; state.countryProgressTimes = [];
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('country.worker')) {
          state.countryWorkerCount++;
          this.addEventListener('message', event => {
            if (!event.data.complete) state.countryProgressTimes.push(performance.now());
          });
        }
      }
    };
  });
  try {
    await page.goto('/tests/country-app.html');
    await page.getByTitle('Analytics', { exact: true }).click();
    await page.getByRole('button', { name: 'Group by country' }).click();
    await expect(page.getByRole('status')).toHaveText('Calculating country distances for Pending route…');
    await expect(page.getByRole('button', { name: /Unassigned/ })).toContainText('222.4');
    await expect(page.getByRole('button', { name: /Country A/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { countryProgressTimes: number[] }).countryProgressTimes.length)).toBeGreaterThanOrEqual(3);
    const timing = await page.evaluate(() => (window as unknown as { countryProgressTimes: number[] }).countryProgressTimes);
    expect(timing[2] - timing[1]).toBeGreaterThanOrEqual(400);
    await expect(page.getByRole('button', { name: /Unassigned/ })).toContainText('222.4');
    expect(await page.evaluate(() => (window as unknown as { countryWorkerCount: number }).countryWorkerCount)).toBe(1);
    if (changeRoute) {
      await page.getByTitle('Close Analytics', { exact: true }).click();
      await expect(page.getByTitle('Analytics', { exact: true })).toBeVisible();
      await page.locator('.trip-card').filter({ hasText: pending.name }).click();
      await page.getByTitle('Segment Info', { exact: true }).click();
      await page.getByTitle('Flight', { exact: true }).click();
      await page.goBack();
      await expect.poll(async () => (await cachedTrips(page)).find(trip => trip.id === pending.id)?.segments[0].countryDistances?.[UNASSIGNED]).toBeDefined();
      expect(await page.evaluate(() => (window as unknown as { countryWorkerCount: number }).countryWorkerCount)).toBe(2);
      release();
      await page.goBack();
      await page.getByTitle('Analytics', { exact: true }).click();
      await page.getByRole('button', { name: 'Group by country' }).click();
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Unassigned/ })).toContainText('444.8');
      await expect(page.getByRole('button', { name: /Country A/ })).toHaveCount(0);
      return;
    }
    await page.getByRole('button', { name: /Unassigned/ }).click();
    await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const state = window as unknown as { countryAutoFits: number; testMap: { stop(): void; flyTo(options: unknown): unknown; jumpTo(options: unknown): void } };
      const map = state.testMap;
      map.stop();
      state.countryAutoFits = 0;
      const flyTo = map.flyTo.bind(map);
      map.flyTo = options => { state.countryAutoFits++; return flyTo(options); };
      map.jumpTo({ center: [30, 20], zoom: 4 });
    });
    release();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => (window as unknown as { countryAutoFits: number }).countryAutoFits)).toBe(0);
    await page.getByRole('button', { name: /Unassigned/ }).click();
    await expect(page.getByRole('button', { name: /Country A/ })).toContainText('111.2');
    await expect(page.getByRole('button', { name: /Country B/ })).toContainText('111.2');
    expect(await page.evaluate(() => (window as unknown as { countryWorkerCount: number }).countryWorkerCount)).toBe(1);
  } finally { release(); }
});

test('background country work does not rebuild the map or repeatedly serialize unchanged trips', async ({ page, context }) => {
  const ready: Trip = { ...trip, id: 'performance-ready', name: 'Ready route', segments: [segment('ready', 'car', [[-1, 0], [-0.5, 0]])] };
  const pending: Trip = { ...trip, id: 'performance-pending', name: 'Pending route', segments: [segment('pending', 'car', [[0.5, 0], [1, 0]])] };
  await context.route('https://api.github.com/repos/test/trips/contents/trips', route => route.fulfill({ json: [
    { name: 'ready.triplo.json', download_url: 'https://fixtures.test/ready.json' },
    { name: 'pending.triplo.json', download_url: 'https://fixtures.test/pending.json' },
  ] }));
  await context.route('https://fixtures.test/ready.json', route => route.fulfill({ json: ready }));
  await context.route('https://fixtures.test/pending.json', route => route.fulfill({ json: pending }));
  const release: (() => void)[] = [];
  for (const country of countries) {
    const gate = new Promise<void>(resolve => release.push(resolve));
    await context.route(`**/countries/${country.entry.file}*`, async route => {
      await gate;
      await route.fulfill({ contentType: 'application/gzip', body: country.body });
    });
  }
  await page.addInitScript(() => {
    localStorage.setItem('renderStyleConfigs', JSON.stringify([{ id: 'performance', name: 'Performance', script: 'return { getSegmentStyle: () => ({hidden:false}), getWaypointStyle: () => ({hidden:false, type:"dot"}) };' }]));
    localStorage.setItem('activeRenderStyleConfigId', 'performance');
    const state = window as unknown as { countryProgress: number };
    state.countryProgress = 0;
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('country.worker')) this.addEventListener('message', () => state.countryProgress++);
      }
    };
  });
  try {
    await page.goto('/tests/country-app.html');
    await expect.poll(async () => (await routes(page)).length).toBe(2);
    await expect(page.locator('.maplibregl-marker')).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => (window as any).countryProgress)).toBeGreaterThanOrEqual(2);
    const start = await page.evaluate(() => {
      const state = window as any;
      state.mapWork = { uploads: 0, markerRemovals: 0, serializations: 0 };
      const source = state.testMap.getSource('route-source');
      const setData = source.setData.bind(source);
      source.setData = (...args: unknown[]) => { state.mapWork.uploads++; return setData(...args); };
      new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) {
          if (node instanceof HTMLElement && node.matches('.maplibregl-marker')) state.mapWork.markerRemovals++;
        }
      }).observe(document.body, { childList: true, subtree: true });
      const stringify = JSON.stringify;
      JSON.stringify = (value, replacer, space) => {
        if (value?.id?.startsWith('performance-') && value.segments) state.mapWork.serializations++;
        return stringify(value, replacer, space);
      };
      return state.countryProgress;
    });
    await expect.poll(() => page.evaluate(() => (window as any).countryProgress)).toBeGreaterThanOrEqual(start + 3);
    const idle = await page.evaluate(() => {
      const state = window as any;
      state.testMap.jumpTo({ center: [0, 0], zoom: 4 });
      const work = { ...state.mapWork };
      state.mapWork = { uploads: 0, markerRemovals: 0, serializations: 0 };
      return work;
    });
    release[0]();
    await expect.poll(async () => (await cachedTrips(page)).find(trip => trip.id === ready.id)?.segments[0].countryDistances?.AA).toBeGreaterThan(0);
    const cacheArrival = await page.evaluate(() => ({ ...(window as any).mapWork }));
    await test.info().attach('background-map-work', { body: JSON.stringify({ idle, cacheArrival }), contentType: 'application/json' });
    expect(idle).toEqual({ uploads: 0, markerRemovals: 0, serializations: 0 });
    expect(cacheArrival.uploads).toBe(0);
    expect(cacheArrival.markerRemovals).toBe(0);
    expect(cacheArrival.serializations).toBeLessThanOrEqual(1);
    await page.locator('.trip-card').filter({ hasText: ready.name }).click();
    await page.getByTitle('Segment Info', { exact: true }).click();
    await page.getByTitle('Flight', { exact: true }).click();
    await expect.poll(async () => (await routes(page))[0]?.properties?.mode).toBe('flight');
  } finally { release.forEach(resolve => resolve()); }
});

test('country rows stay visible across new trips and identical geometry reloads', async ({ page, context }) => {
  await expect.poll(async () => (await cachedTrips(page))[0]?.segments.every(segment => !!segment.countryDistances)).toBe(true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/countries/BB.json.gz*', async route => {
    await gate;
    await route.fulfill({ contentType: 'application/gzip', body: countries[1].body });
  });
  await page.addInitScript(() => {
    const state = window as unknown as { workerCount: number; calculatingTrips: string[]; missingCountryRows: number };
    state.workerCount = 0; state.calculatingTrips = []; state.missingCountryRows = 0;
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        state.workerCount++;
        this.addEventListener('message', event => {
          if (event.data.currentTrip) state.calculatingTrips.push(event.data.currentTrip.name);
        });
      }
    };
  });
  try {
    await page.goto('/tests/country-state.html');
    await expect(page.getByRole('button', { name: /Country A/ })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.evaluate(() => {
      new MutationObserver(() => {
        if (!Array.from(document.querySelectorAll('.country-row')).some(row => row.textContent?.includes('Country A'))) {
          (window as unknown as { missingCountryRows: number }).missingCountryRows++;
        }
      }).observe(document.querySelector('.country-list')!, { subtree: true, childList: true, characterData: true });
    });
    await page.getByRole('button', { name: 'Add another trip' }).click();
    await expect(page.getByRole('status')).toHaveText('Calculating country distances for New trip…');
    await expect(page.getByRole('button', { name: /Country A/ })).toContainText('55.6');
    await page.getByRole('button', { name: 'Reload identical geometry' }).click();
    await page.getByRole('button', { name: 'Reload identical geometry' }).click();
    release();
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Country B/ })).toContainText('55.6');
    const state = await page.evaluate(() => {
      const { workerCount, calculatingTrips, missingCountryRows } = window as unknown as { workerCount: number; calculatingTrips: string[]; missingCountryRows: number };
      return { workerCount, calculatingTrips, missingCountryRows };
    });
    expect(state.workerCount).toBe(2);
    expect(state.missingCountryRows).toBe(0);
    expect(state.calculatingTrips).not.toContain('Ready trip');
  } finally { release(); }
});

test('country and transport tables share sizing, Unassigned is last, and attribution belongs in Status', async ({ page, context }) => {
  const fixture = { ...trip, id: 'table-style-trip', segments: [trip.segments[0], segment('long-flight', 'flight', [[-10, 0], [10, 0]])] };
  await context.route('https://fixtures.test/trip.json', route => route.fulfill({ json: fixture }));
  await page.goto('/tests/country-app.html');
  await page.getByTitle('Analytics', { exact: true }).click();
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.locator('.country-row')).toHaveCount(3);
  await expect(page.locator('.country-row').last()).toContainText('Unassigned');
  await expect(page.locator('.country-list .analytics-summary-header')).toContainText('Country (2)');
  await expect(page.locator('.country-list')).toContainText('Distance (km)');
  await expect(page.locator('.country-list a')).toHaveCount(0);
  const sizing = () => page.evaluate(() => {
    const row = document.querySelector('.analytics-summary-row')!;
    const header = document.querySelector('.analytics-summary-header')!;
    const styles = (element: Element) => {
      const style = getComputedStyle(element);
      return { font: style.fontSize, padding: style.padding, lineHeight: style.lineHeight, columns: style.gridTemplateColumns, weight: style.fontWeight, border: style.borderBottom, height: element.getBoundingClientRect().height };
    };
    return { row: styles(row), header: styles(header) };
  });
  const country = await sizing();
  await page.getByRole('button', { name: 'Group by country' }).click();
  expect(await sizing()).toEqual(country);
  await page.goto('/tests/country-app.html');
  await page.getByTitle('Status', { exact: true }).click();
  const providers = page.getByRole('region', { name: 'Other providers' });
  const logo = providers.getByRole('img', { name: 'Overture Maps logo' });
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(providers.getByRole('link', { name: '© Overture Maps Foundation' })).toHaveAttribute('href', 'https://docs.overturemaps.org/attribution/');
  await expect(providers.getByRole('link', { name: 'ODbL 1.0' })).toBeVisible();
  await expect(providers).not.toContainText('OpenStreetMap');
});

test('country labels use Overture English names including synthetic territory codes', async ({ page, context }) => {
  const codes = [{ code: 'AT', name: 'Österreich' }, { code: 'XA', name: 'Хабомаи' }];
  const localized = countries.map((country, i) => {
    const { code, name } = codes[i];
    const west = i ? 0 : -2, east = i ? 2 : 0;
    const geometry = { type: 'Polygon', coordinates: [[[west, -2], [east, -2], [east, 2], [west, 2], [west, -2]]] };
    const body = gzipSync(JSON.stringify({ code, land: geometry, territorial: geometry }));
    return { body, entry: { ...country.entry, code, name, file: `${code}.json.gz`, sha256: createHash('sha256').update(body).digest('hex') } };
  });
  await context.route('**/countries/index.json', route => route.fulfill({ json: { version: 'english-test', countries: localized.map(country => country.entry), attribution: 'Test' } }));
  for (const country of localized) await context.route(`**/countries/${country.entry.file}*`, route => route.fulfill({ contentType: 'application/gzip', body: country.body }));
  await context.route('https://fixtures.test/trip.json', route => route.fulfill({ json: { ...trip, id: 'english-names' } }));
  await page.goto('/tests/country-app.html');
  await page.getByTitle('Analytics', { exact: true }).click();
  await page.getByRole('button', { name: 'Group by country' }).click();
  await expect(page.getByRole('button', { name: /Austria/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Habomai Islands/ })).toBeVisible();
  await expect(page.locator('.country-list')).not.toContainText('Österreich');
  await expect(page.locator('.country-list')).not.toContainText('Хабомаи');
});
