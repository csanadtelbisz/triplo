import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Trip } from '../../shared/types';

const trips: Trip[] = Array.from({ length: 115 }, (_, index) => ({
  id: `trip-${index}`,
  name: `Trip ${index}`,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  segments: [],
}));

async function drive(page: Page, emptyMiddlePage = false) {
  const remote = new Map(trips.map(trip => [trip.id, trip]));
  const uploads: string[] = [];
  const tokens: (string | null)[] = [];
  const continuation = 'next+/=& page';
  let listings = 0;
  let ordered = [...remote.values()];
  await page.addInitScript(() => {
    localStorage.setItem('gdrive_access_token', 'test-token');
    localStorage.setItem('gdrive_token_expires_at', String(Date.now() + 3600000));
    localStorage.setItem('startMinimized', 'false');
  });
  await page.route('https://accounts.google.com/**', route => route.abort());
  await page.route('https://www.googleapis.com/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes('/upload/')) {
      const trip = request.postDataJSON() as Trip;
      remote.set(trip.id, trip);
      uploads.push(trip.id);
      return route.fulfill({ json: {} });
    }
    if (request.method() === 'POST') {
      return route.fulfill({ json: { id: request.postDataJSON().name.replace('.triplo.json', '') } });
    }
    if (url.searchParams.get('alt') === 'media') {
      return route.fulfill({ json: remote.get(url.pathname.split('/').pop()!) });
    }
    const query = url.searchParams.get('q') || '';
    if (query.includes('application/vnd.google-apps.folder')) {
      return route.fulfill({ json: { files: [{ id: 'folder' }] } });
    }
    if (!query.includes("name contains '.triplo.json'")) {
      const trip = [...remote.values()].find(trip => query.includes(`name='${trip.id}.triplo.json'`));
      return route.fulfill({ json: { files: trip ? [{ id: trip.id }] : [] } });
    }
    const token = url.searchParams.get('pageToken');
    tokens.push(token);
    if (!token) {
      ordered = [...remote.values()];
      if (++listings % 2 === 0) ordered.reverse();
    }
    const empty = emptyMiddlePage && token === continuation;
    const items = empty ? undefined : token ? ordered.slice(100) : ordered.slice(0, 100);
    const nextPageToken = !token ? continuation : empty ? 'last-page' : undefined;
    // Drive only returns continuation tokens when the fields mask includes them.
    return route.fulfill({ json: {
      files: items?.map(trip => ({ id: trip.id, name: `${trip.id}.triplo.json` })),
      ...(url.searchParams.get('fields')?.includes('nextPageToken') ? { nextPageToken } : {}),
    } });
  });
  await page.goto('/tests/persisting-services.html');
  return { uploads, tokens, continuation };
}

for (const emptyMiddlePage of [false, true]) {
  test(`Drive loads all 115 trips on repeated syncs${emptyMiddlePage ? ' through an empty intermediate page' : ''}`, async ({ page }) => {
    const fixture = await drive(page, emptyMiddlePage);
    const results = await page.evaluate(async () => {
      const module = '/src/persisting/GoogleDrivePersistingService.tsx';
      const { GoogleDrivePersistingService } = await import(module);
      const service = new GoogleDrivePersistingService();
      return [await service.load(), await service.load()];
    });
    for (const loaded of results) {
      expect(loaded.map((trip: Trip) => trip.id).sort()).toEqual(trips.map(trip => trip.id).sort());
    }
    const expectedTokens = [null, fixture.continuation, ...(emptyMiddlePage ? ['last-page'] : [])];
    expect(fixture.tokens).toEqual([...expectedTokens, ...expectedTokens]);
    expect(fixture.uploads).toEqual([]);
  });
}

test('accept latest uploads only the truly missing trip and subsequent sync stays resolved', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  const fixture = await drive(page);
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('**/countries/index.json', route => route.fulfill({ json: { version: 'empty', countries: [], attribution: 'Test' } }));
  const missing: Trip = { ...trips[0], id: 'missing-trip', name: 'Actually missing trip' };
  await page.evaluate(async records => {
    const module = '/src/api/client.ts';
    const { TripAPI } = await import(module);
    await Promise.all(records.map(trip => TripAPI.saveTrip(trip)));
    document.body.innerHTML = '<div id="root"></div>';
    const app = '/tests/country-app.tsx';
    await import(app);
  }, [...trips, missing]);

  const sync = page.getByTitle('Reload from all services', { exact: true });
  await expect(sync).toBeEnabled();
  await page.getByTitle('Sync conflicts or missing trips', { exact: true }).click();
  await expect(page.getByText('Actually missing trip: missing from Google Drive', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Accept latest and upload missing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Resolve Sync Conflicts', exact: true })).toHaveCount(0);
  expect(fixture.uploads).toEqual(['missing-trip']);

  await sync.click();
  await expect(sync).toBeEnabled();
  await expect(page.getByTitle('Sync conflicts or missing trips', { exact: true })).toHaveCount(0);
  expect(fixture.uploads).toEqual(['missing-trip']);
});
