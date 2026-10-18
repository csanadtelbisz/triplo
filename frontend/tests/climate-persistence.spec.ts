import { test, expect } from '@playwright/test';
import type { Trip } from '../../shared/types';

test('real app persists climate caches, refreshes preference changes, and reloads saved estimates', async ({ page, context }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1100, height: 850 });
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    localStorage.setItem('github_token', 'test-token');
    localStorage.setItem('github_repo', 'test/trips');
    localStorage.setItem('startMinimized', 'false');
    if (!localStorage.getItem('climateProfiles')) localStorage.setItem('climateProfiles', JSON.stringify([
      { id: 'car', name: 'My car', profile: { mode: 'car', fuelType: 'petrol', exactFuelLPer100Km: 6, occupancy: 2 } },
    ]));
    localStorage.setItem('builtInModeOverrides', JSON.stringify({ car: { climateProfileId: 'car' } }));
  });
  let remote: Trip = { id: 'cached', name: 'Cached climate trip', startDate: '2026-05-01', createdAt: '', updatedAt: '', segments: [{
    id: 'drive', name: 'Drive', transportMode: 'car', routingService: 'manual', routingProfile: 'straight', source: 'manual',
    geometry: { type: 'LineString', coordinates: [[19, 47], [20, 47]] },
    waypoints: [{ id: 'a', coordinates: [19, 47] }, { id: 'b', coordinates: [20, 47] }],
  }] };
  let writes = 0;
  await context.route('https://api.github.com/**', route => {
    const url = route.request().url();
    if (route.request().method() === 'PUT' && url.includes('/contents/trips/')) {
      remote = JSON.parse(Buffer.from(route.request().postDataJSON().content, 'base64').toString('utf8'));
      writes++;
      return route.fulfill({ json: { content: { sha: 'saved' } } });
    }
    return route.fulfill({ status: url.endsWith('/contents/trips') ? 200 : 404,
      json: url.endsWith('/contents/trips') ? [{ name: 'cached.triplo.json', download_url: 'https://fixtures.test/climate.json' }] : {} });
  });
  await context.route('https://fixtures.test/climate.json', route => route.fulfill({ json: remote }));
  await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } }));
  await context.route('**/countries/index.json', route => route.fulfill({ json: { version: 'empty-fixture', countries: [], attribution: 'Test boundaries' } }));
  await page.goto('/tests/country-app.html');
  const browserCache = () => page.evaluate(() => new Promise<Trip[]>((resolve, reject) => {
    const request = indexedDB.open('TriploDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('trips').objectStore('trips').get('triplo_cached_trips_v2');
      read.onsuccess = () => { resolve(read.result || []); db.close(); };
      read.onerror = () => { reject(read.error); db.close(); };
    };
  }));
  await expect.poll(async () => (await browserCache())[0]?.segments[0].countryParts?.length).toBe(1);
  await expect.poll(async () => (await browserCache())[0]?.segments[0].climateImpact?.result?.co2eKg || 0).toBeGreaterThan(0);
  await page.getByTitle('Save All Unsaved Trips', { exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  const original = remote.segments[0].climateImpact!;
  expect(original.result?.co2eKg).toBeGreaterThan(0);
  expect(remote.segments[0].geometry).toBeUndefined();
  expect(remote.segments[0].distanceStats).toBeUndefined();
  await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const profiles = JSON.parse(localStorage.getItem('climateProfiles')!);
    profiles[0].profile.occupancy = 4;
    localStorage.setItem('climateProfiles', JSON.stringify(profiles));
    window.dispatchEvent(new Event('preferences-updated'));
  });
  await expect.poll(async () => (await browserCache())[0]?.segments[0].climateImpact?.result?.co2eKg).toBeCloseTo(original.result!.co2eKg / 2);
  await page.getByTitle('Save All Unsaved Trips', { exact: true }).click();
  await expect.poll(() => writes).toBe(2);
  expect(remote.segments[0].climateImpact?.inputKey).not.toBe(original.inputKey);
  await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTitle('Reload from all services', { exact: true })).toBeEnabled({ timeout: 15000 });
  await expect.poll(async () => (await browserCache())[0]?.segments[0].climateImpact?.inputKey).toBe(remote.segments[0].climateImpact!.inputKey);
  await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toHaveCount(0);
});
