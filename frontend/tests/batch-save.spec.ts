import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Trip } from '../../shared/types';
import { PersistingService } from '../src/persisting/PersistingService';

const trips: Trip[] = ['First trip Árvíz', 'Second trip'].map((name, i) => ({ id: `trip-${i}`, name, createdAt: '', updatedAt: '', segments: [] }));

test('default batch saving runs sequentially and propagates a partial failure', async () => {
  const saved: string[] = [];
  const service = { save: async (trip: Trip) => { saved.push(trip.id); if (trip.id === 'trip-1') throw new Error('Upload failed'); } };
  await expect(PersistingService.prototype.saveAll.call(service, [...trips, { ...trips[0], id: 'third' }])).rejects.toThrow('Upload failed');
  expect(saved).toEqual(['trip-0', 'trip-1']);
});

type GitFixture = { fail?: 'blob' | 'commit' | 'ref'; unchanged?: boolean; empty?: boolean };
async function github(page: Page, options: GitFixture = {}) {
  const requests: { method: string; path: string; body: Record<string, unknown> }[] = [];
  await page.addInitScript(() => { localStorage.setItem('github_token', 'test-token'); localStorage.setItem('github_repo', 'test/trips'); });
  await page.route('https://api.github.com/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/repos/test/trips', '');
    const body = request.postData() ? request.postDataJSON() : {};
    requests.push({ method: request.method(), path, body });
    if (path === '') return route.fulfill({ json: { default_branch: 'travel/current' } });
    if (path === '/git/ref/heads/travel/current') return route.fulfill(options.empty ? { status: 409, json: { message: 'Git Repository is empty.' } } : { json: { object: { sha: 'head' } } });
    if (path === '/git/commits/head') return route.fulfill({ json: { tree: { sha: 'base-tree' } } });
    if (path === '/git/blobs') {
      const trip = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8'));
      return route.fulfill(options.fail === 'blob' ? { status: 500, json: { message: 'Upload failed' } } : { json: { sha: `blob-${trip.id}` } });
    }
    if (path === '/git/trees') return route.fulfill({ json: { sha: options.unchanged ? 'base-tree' : 'new-tree' } });
    if (path === '/git/commits') return route.fulfill(options.fail === 'commit' ? { status: 403, json: { message: 'Branch protected' } } : { json: { sha: 'new-commit' } });
    if (path === '/git/refs/heads/travel/current') return route.fulfill(options.fail === 'ref' ? { status: 422, json: { message: 'Update is not a fast forward' } } : { json: { object: { sha: 'new-commit' } } });
    if (path.startsWith('/contents/trips/') && request.method() === 'PUT') return route.fulfill({ json: { content: { sha: 'saved' } } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('/tests/persisting-services.html');
  return requests;
}

async function saveGithub(page: Page, items = trips) {
  return page.evaluate(async trips => {
    const module = '/src/persisting/GitHubPersistingService.tsx';
    const { GitHubPersistingService } = await import(module);
    try { await new GitHubPersistingService().saveAll(trips); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, items);
}

test('GitHub batch publishes both UTF-8 trip files in one commit and preserves other files', async ({ page }) => {
  const requests = await github(page);
  expect(await saveGithub(page)).toBeNull();
  const writes = requests.filter(r => r.method !== 'GET');
  const blobs = writes.filter(r => r.path === '/git/blobs');
  expect(blobs).toHaveLength(2);
  expect(blobs.map(r => JSON.parse(Buffer.from(r.body.content as string, 'base64').toString('utf8')).name).sort()).toEqual(trips.map(t => t.name).sort());
  expect(writes.find(r => r.path === '/git/trees')!.body).toEqual({ base_tree: 'base-tree', tree: [
    { path: 'trips/trip-0.triplo.json', mode: '100644', type: 'blob', sha: 'blob-trip-0' },
    { path: 'trips/trip-1.triplo.json', mode: '100644', type: 'blob', sha: 'blob-trip-1' },
  ] });
  expect(writes.filter(r => r.path === '/git/commits').map(r => r.body)).toEqual([{ message: 'Triplo: Sync 2 trips', tree: 'new-tree', parents: ['head'] }]);
  expect(writes.filter(r => r.method === 'PATCH').map(r => r.body)).toEqual([{ sha: 'new-commit', force: false }]);
  expect(writes.filter(r => r.method === 'PUT')).toHaveLength(0);
});

for (const fail of ['blob', 'commit', 'ref'] as const) test(`GitHub batch reports ${fail} failure without falling back to individual commits`, async ({ page }) => {
  const requests = await github(page, { fail });
  expect(await saveGithub(page)).toContain('GitHub batch save failed');
  expect(requests.filter(r => r.method === 'PUT')).toHaveLength(0);
  if (fail !== 'ref') expect(requests.filter(r => r.method === 'PATCH')).toHaveLength(0);
  else expect(requests.find(r => r.method === 'PATCH')!.body.force).toBe(false);
});

test('unchanged and empty GitHub batches produce no commits', async ({ page }) => {
  const requests = await github(page, { unchanged: true });
  expect(await saveGithub(page, [])).toBeNull();
  expect(requests).toHaveLength(0);
  expect(await saveGithub(page)).toBeNull();
  expect(requests.some(r => r.path === '/git/commits' && r.method === 'POST')).toBe(false);
  expect(requests.some(r => r.method === 'PATCH')).toBe(false);
});

test('empty GitHub repositories keep first-save support through the default loop', async ({ page }) => {
  const requests = await github(page, { empty: true });
  expect(await saveGithub(page)).toBeNull();
  expect(requests.filter(r => r.method === 'PUT').map(r => r.path)).toEqual(['/contents/trips/trip-0.triplo.json', '/contents/trips/trip-1.triplo.json']);
  expect(requests.some(r => r.path === '/git/blobs')).toBe(false);
});

test('Google Drive inherits sequential content uploads and reports upload failure', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('gdrive_access_token', 'test-token'); localStorage.setItem('gdrive_token_expires_at', String(Date.now() + 3600000)); });
  await page.route('https://accounts.google.com/**', route => route.abort());
  const uploads: string[] = [];
  await page.route('https://www.googleapis.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/upload/')) {
      uploads.push(JSON.parse(route.request().postData()!).id);
      return route.fulfill(uploads.length === 2 ? { status: 403, json: { error: 'Quota' } } : { json: {} });
    }
    const query = url.searchParams.get('q') || '';
    return route.fulfill({ json: { files: [{ id: query.includes('application/vnd.google-apps.folder') ? 'folder' : 'file' }] } });
  });
  await page.goto('/tests/persisting-services.html');
  const error = await page.evaluate(async trips => {
    const module = '/src/persisting/GoogleDrivePersistingService.tsx';
    const { GoogleDrivePersistingService } = await import(module);
    try { await new GoogleDrivePersistingService().saveAll([...trips, { ...trips[0], id: 'third' }]); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, trips);
  expect(error).toContain('Drive API Error: 403');
  expect(uploads).toEqual(['trip-0', 'trip-1']);
});

for (const fails of [false, true]) test(`real Save All ${fails ? 'keeps both trips unsaved after a concurrent push' : 'saves both changed trips in one commit'}`, async ({ page }) => {
  test.setTimeout(60000);
  const requests = await github(page, fails ? { fail: 'ref' } : {});
  const alerts: string[] = [];
  page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.addInitScript(() => localStorage.setItem('startMinimized', 'false'));
  const records: Trip[] = trips.map(t => ({ ...t, startDate: '2026-05-01', segments: [{
    id: 'drive', transportMode: 'car', routingService: 'manual', routingProfile: 'straight', source: 'manual',
    geometry: { type: 'LineString', coordinates: [[19, 47], [20, 47]] },
    waypoints: [{ id: 'a', coordinates: [19, 47] }, { id: 'b', coordinates: [20, 47] }],
  }] }));
  await page.route('https://api.github.com/repos/test/trips/contents/trips', route => route.fulfill({ json: records.map(t => ({ name: `${t.id}.triplo.json`, download_url: `https://fixtures.test/${t.id}.json` })) }));
  await page.route('https://fixtures.test/**', route => route.fulfill({ json: records.find(t => route.request().url().endsWith(`/${t.id}.json`)) }));
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background' }] } }));
  await page.route('**/countries/index.json', route => route.fulfill({ json: { version: 'empty-fixture', countries: [], attribution: 'Test boundaries' } }));
  await page.goto('/tests/country-app.html');
  await expect(page.getByTitle('Unsaved changes', { exact: true })).toHaveCount(2, { timeout: 15000 });
  await page.getByTitle('Save All Unsaved Trips', { exact: true }).click();
  await expect.poll(() => requests.filter(r => r.method === 'PATCH')).toHaveLength(1);
  if (fails) {
    await expect.poll(() => alerts).toContain('Failed to save some trips');
    await expect(page.getByTitle('Unsaved changes', { exact: true })).toHaveCount(2);
    await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toBeVisible();
  } else {
    await expect(page.getByTitle('Save All Unsaved Trips', { exact: true })).toHaveCount(0);
    await expect(page.getByTitle('Unsaved changes', { exact: true })).toHaveCount(0);
    expect(alerts).toEqual([]);
  }
  expect(requests.filter(r => r.path === '/git/commits' && r.method === 'POST')).toHaveLength(1);
  expect(requests.filter(r => r.method === 'PUT')).toHaveLength(0);
  const saved = requests.filter(r => r.path === '/git/blobs').map(r => JSON.parse(Buffer.from(r.body.content as string, 'base64').toString('utf8')) as Trip);
  expect(saved.map(t => t.id).sort()).toEqual(['trip-0', 'trip-1']);
  for (const trip of saved) {
    expect(trip.segments[0].countryParts).toHaveLength(1);
    expect(trip.segments[0].climateImpact).toBeUndefined();
  }
});
