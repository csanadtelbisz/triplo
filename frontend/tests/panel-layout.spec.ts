import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Trip } from '../../shared/types';

const waypoints = Array.from({ length: 30 }, (_, i) => ({ id: `point-${i}`, name: `Point ${i}`, coordinates: [19 + i * .001, 47] as [number, number] }));
const trip: Trip = {
  id: 'panel-layout', name: 'Panel layout trip', createdAt: '', updatedAt: '',
  segments: [{ id: 'walk', transportMode: 'walk', source: 'manual', routingService: 'manual', routingProfile: 'straight',
    waypoints, geometry: { type: 'LineString', coordinates: waypoints.map(point => point.coordinates) },
  }],
};

async function openApp(page: Page, sourceTrip = trip) {
  await page.addInitScript(() => {
    localStorage.setItem('github_token', 'test-token');
    localStorage.setItem('github_repo', 'test/trips');
    localStorage.setItem('startMinimized', 'false');
  });
  await page.route('https://api.github.com/**', route => route.fulfill({
    status: route.request().url().endsWith('/contents/trips') ? 200 : 404,
    json: route.request().url().endsWith('/contents/trips') ? [{ name: 'trip.triplo.json', download_url: 'https://fixtures.test/trip.json' }] : {},
  }));
  await page.route('https://fixtures.test/trip.json', route => route.fulfill({ json: sourceTrip }));
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('**/countries/index.json', route => route.fulfill({ json: { version: 'empty', countries: [], attribution: 'Test' } }));
  await page.goto('/tests/country-app.html');
  await page.locator('.trip-card').filter({ hasText: trip.name }).click();
  await expect(page.locator('.waypoint-title-input')).toHaveCount(sourceTrip.segments[0].waypoints.length);
  if (page.viewportSize()!.width <= 768) {
    // Selecting a trip collapses the sheet to show its route on the map.
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);
    const bottomInset = await page.locator('.map-panel').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--safe-area-inset-bottom')) || 0);
    await expect.poll(() => page.locator('.sidebar').evaluate(element => Math.round(element.getBoundingClientRect().top))).toBe(page.viewportSize()!.height - 64 - bottomInset);
    await page.locator('.mobile-drag-handle').tap();
    await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/);
    await expect.poll(() => page.locator('.sidebar').evaluate(element => Math.round(element.getBoundingClientRect().bottom))).toBe(page.viewportSize()!.height);
  }
}

for (const width of [390, 1100]) test(`adding a waypoint again restores the ${width <= 768 ? 'mobile' : 'desktop'} editor position before scrolling to it`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  await openApp(page);
  const row = page.locator('.waypoint-row-tr[data-wpid="point-10"]');
  // Navigate in the same frame as the final scroll movement, before the browser
  // delivers its scroll event. The editor must remember its actual position.
  const previousScroll = await row.evaluate(element => {
    const content = element.closest('.content')!;
    content.scrollTop += element.getBoundingClientRect().top - content.getBoundingClientRect().top - content.clientHeight / 2;
    const position = content.scrollTop;
    element.querySelector<HTMLButtonElement>('button[title="Waypoint Info"]')!.click();
    return position;
  });
  expect(previousScroll).toBeGreaterThan(200);
  await expect(page.getByRole('heading', { name: 'Waypoint Info', exact: true })).toBeVisible();

  await page.evaluate(() => {
    const state = window as unknown as { editorFrames: number[]; highlightScrollStart?: number };
    state.editorFrames = [];
    const scrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (...args: Parameters<Element['scrollTo']>) {
      if (this.matches('.sidebar > .content') && typeof args[0] === 'object' && args[0].behavior === 'smooth') {
        state.highlightScrollStart = this.scrollTop;
      }
      return scrollTo.apply(this, args);
    };
    const sample = () => {
      if (document.querySelector('.waypoint-title-input')) {
        state.editorFrames.push(document.querySelector('.sidebar > .content')!.scrollTop);
      }
      if (state.highlightScrollStart === undefined) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.getByTitle('Add point again as last waypoint', { exact: true }).evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('.waypoint-title-input')).toHaveCount(31);
  await expect.poll(() => page.evaluate(() => (window as unknown as { highlightScrollStart?: number }).highlightScrollStart)).toBeCloseTo(previousScroll, 0);
  const frames = await page.evaluate(() => (window as unknown as { editorFrames: number[] }).editorFrames);
  expect(frames.length).toBeGreaterThan(0);
  expect(Math.min(...frames)).toBeGreaterThanOrEqual(previousScroll - 1);
  await expect(page.locator('.waypoint-title-input').last()).toBeInViewport();
});

const routedTrip: Trip = { ...trip, segments: [{ ...trip.segments[0], source: 'router', routingService: 'GraphHopper Router',
  routingProfile: 'foot', waypoints: waypoints.slice(0, 3),
  geometry: { type: 'LineString', coordinates: waypoints.slice(0, 3).map(point => point.coordinates) },
}] };

async function routingApp(page: Page) {
  await page.addInitScript(() => localStorage.setItem('apiKeyPreferences', JSON.stringify({ graphHopperApiKey: 'test-key' })));
  const pending: { release: () => void; finished: Promise<void> }[] = [];
  await page.route('https://graphhopper.com/api/1/route**', async route => {
    let release!: () => void;
    let finished!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const complete = new Promise<void>(resolve => { finished = resolve; });
    const elevation = 100 + pending.length;
    pending.push({ release, finished: complete });
    await wait;
    await route.fulfill({ json: { paths: [{ points: { type: 'LineString', coordinates: route.request().postDataJSON().points.map((point: number[]) => [...point, elevation]) } }] } });
    finished();
  });
  await openApp(page, routedTrip);
  return pending;
}

async function addFirstWaypointAgain(page: Page) {
  await page.getByTitle('Waypoint Info', { exact: true }).first().click();
  await page.getByTitle('Add point again as last waypoint', { exact: true }).click();
}

async function routeElevations(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { testMap: import('maplibre-gl').Map }).testMap;
    const data = (map.getSource('route-source') as import('maplibre-gl').GeoJSONSource).serialize().data as GeoJSON.FeatureCollection<GeoJSON.MultiLineString>;
    return data.features.flatMap(feature => feature.geometry.coordinates.flatMap(line => line.map(coordinate => coordinate[2]))).filter(value => value !== undefined);
  });
}

for (const width of [390, 1100]) test(`adding a routed waypoint returns to the ${width <= 768 ? 'mobile' : 'desktop'} editor before routing finishes`, async ({ page }) => {
  await page.setViewportSize({ width, height: 850 });
  const pending = await routingApp(page);
  try {
    await addFirstWaypointAgain(page);
    await expect(page.getByRole('heading', { name: 'Waypoint Info', exact: true })).toHaveCount(0);
    await expect(page.locator('.waypoint-title-input')).toHaveCount(4);
    await expect(page.locator('.waypoint-title-input').last()).toBeInViewport();
    await expect.poll(() => pending.length).toBe(1);
    await page.locator('.waypoint-title-input').last().fill('Renamed while routing');
    await page.locator('.waypoint-title-input').last().blur();
    pending[0].release();
    await expect.poll(() => routeElevations(page)).toContain(100);
    await expect(page.locator('.waypoint-title-input').last()).toHaveValue('Renamed while routing');
    expect(pending).toHaveLength(1);
  } finally { for (const request of pending) request.release(); }
});

test('segment mode changes appear and the panel can close while routing is pending', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  const pending = await routingApp(page);
  try {
    await page.getByTitle('Segment Info', { exact: true }).click();
    await page.getByTitle('Car', { exact: true }).click();
    await expect(page.getByTitle('Car', { exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => pending.length).toBe(1);
    await page.locator('.sidebar .toolbar:visible button').first().click();
    await expect(page.locator('.waypoint-title-input')).toHaveCount(3);
    pending[0].release();
    await expect.poll(() => routeElevations(page)).toContain(100);
  } finally { for (const request of pending) request.release(); }
});

test('late routing cannot overwrite a newer edit and route completion adds no undo step', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  const pending = await routingApp(page);
  try {
    await addFirstWaypointAgain(page);
    await expect(page.locator('.waypoint-title-input')).toHaveCount(4);
    await expect.poll(() => pending.length).toBe(1);
    await addFirstWaypointAgain(page);
    await expect(page.locator('.waypoint-title-input')).toHaveCount(5);
    await expect.poll(() => pending.length).toBe(2);
    pending[1].release();
    await expect.poll(() => routeElevations(page)).toContain(101);
    pending[0].release();
    await pending[0].finished;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.waypoint-title-input')).toHaveCount(5);
    expect(await routeElevations(page)).not.toContain(100);
    await page.getByTitle('Undo', { exact: true }).click();
    await expect(page.locator('.waypoint-title-input')).toHaveCount(4);
    await page.getByTitle('Undo', { exact: true }).click();
    await expect(page.locator('.waypoint-title-input')).toHaveCount(3);
  } finally { for (const request of pending) request.release(); }
});

test('undoing a waypoint addition while routing is pending keeps it undone', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 });
  const pending = await routingApp(page);
  try {
    await addFirstWaypointAgain(page);
    await expect.poll(() => pending.length).toBe(1);
    await page.getByTitle('Undo', { exact: true }).click();
    await expect(page.locator('.waypoint-title-input')).toHaveCount(3);
    pending[0].release();
    await pending[0].finished;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('.waypoint-title-input')).toHaveCount(3);
    expect(await routeElevations(page)).not.toContain(100);
    await page.getByTitle('Redo', { exact: true }).click();
    await expect(page.locator('.waypoint-title-input')).toHaveCount(4);
    await expect.poll(() => routeElevations(page)).toContain(100);
  } finally { for (const request of pending) request.release(); }
});

test('mobile panels extend to the bottom edge while controls respect emulated safe areas', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 32, bottom: 24, topMax: 32, bottomMax: 24 } });
  await openApp(page);
  const viewport = page.viewportSize()!;
  const sidebar = page.locator('.sidebar');
  const map = page.locator('#map');
  expect((await map.boundingBox())!.y).toBe(0);
  expect((await map.boundingBox())!.height).toBe(viewport.height);
  expect(await page.locator('.top-left-controls').evaluate(element => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(32);
  expect(await page.locator('.sidebar > .content').evaluate(element => parseFloat(getComputedStyle(element).paddingBottom))).toBe(40);

  await page.getByTitle('Search POI or Coordinates', { exact: true }).click();
  await expect(sidebar).toHaveClass(/search-maximized/);
  await expect.poll(async () => {
    const rect = (await sidebar.boundingBox())!;
    return Math.round(rect.y + rect.height);
  }).toBe(viewport.height);
  expect((await sidebar.boundingBox())!.y).toBe(32);

  // Search stays expanded even if the collapse state is set, so return first.
  await page.locator('.sidebar .toolbar button').first().click();
  await page.evaluate(() => {
    const handle = document.querySelector('.mobile-drag-handle')!;
    handle.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [new Touch({ identifier: 1, target: handle, clientY: 300 })] }));
    handle.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [new Touch({ identifier: 1, target: handle, clientY: 500 })] }));
  });
  await expect(sidebar).toHaveClass(/collapsed/);
  await expect.poll(async () => Math.round((await sidebar.boundingBox())!.y)).toBe(viewport.height - 64 - 24);
  expect(await sidebar.evaluate(element => getComputedStyle(element).bottom)).toBe('0px');
});
