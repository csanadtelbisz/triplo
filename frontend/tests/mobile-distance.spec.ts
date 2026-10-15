import { test, expect } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';

type TestWindow = Window & {
  mapReady: boolean;
  map: { getZoom(): number; jumpTo(options: { zoom: number }): void; remove(): void };
  removeMeasurement(): void;
  formatMeasurementDistance(meters: number): string;
};

const initialTouches = [{ id: 1, x: 100, y: 200 }, { id: 2, x: 290, y: 200 }];
const pinchedTouches = [{ id: 1, x: 50, y: 200 }, { id: 2, x: 340, y: 200 }];
const overlay = (page: Page) => page.locator('.map-distance-measurement');
const zoom = (page: Page) => page.evaluate(() => (window as unknown as TestWindow).map.getZoom());

async function touch(session: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints = initialTouches) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : touchPoints,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/map-distance.html');
  await page.waitForFunction(() => (window as unknown as TestWindow).mapReady);
});

test('distance units and precision match the requested examples and boundary', async ({ page }) => {
  const actual = await page.evaluate(() => [0, 0.6, 94.2, 999.4, 1000, 1000.1, 1234, 94234, 274321, 1234567].map(
    meters => (window as unknown as TestWindow).formatMeasurementDistance(meters),
  ));
  expect(actual).toEqual(['0 m', '1 m', '94 m', '999 m', '1000 m', '1.00 km', '1.23 km', '94.2 km', '274 km', '1230 km']);
});

test('two stationary fingers show a centered measurement after 250ms, then release hides it', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await page.evaluate(() => {
    const state = window as unknown as { holdStarted: number; holdElapsed: number };
    document.addEventListener('touchstart', () => { state.holdStarted = performance.now(); }, { once: true });
    const observer = new MutationObserver(() => {
      if (document.querySelector('.map-distance-measurement')) {
        state.holdElapsed = performance.now() - state.holdStarted;
        observer.disconnect();
      }
    });
    observer.observe(document.body, { subtree: true, childList: true });
  });
  await touch(session, 'touchStart');
  await expect(overlay(page)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { holdElapsed: number }).holdElapsed)).toBeGreaterThanOrEqual(240);
  await expect(overlay(page).locator('text')).toHaveText(/^[\d.]+ km$/);
  await expect(overlay(page).locator('text')).toHaveAttribute('x', '195');
  await expect(overlay(page).locator('text')).toHaveAttribute('y', '200');
  await expect(overlay(page).locator('line')).toHaveCount(2);
  await touch(session, 'touchEnd');
  await expect(overlay(page)).toHaveCount(0);
});

for (const afterHold of [false, true]) {
  test(`pinch ${afterHold ? 'after' : 'before'} rendering hides the line and still zooms`, async ({ page, context }) => {
    const session = await context.newCDPSession(page);
    const before = await zoom(page);
    await touch(session, 'touchStart');
    if (afterHold) await expect(overlay(page)).toBeVisible();
    await touch(session, 'touchMove', pinchedTouches);
    await expect(overlay(page)).toHaveCount(0);
    await page.waitForTimeout(400);
    await expect(overlay(page)).toHaveCount(0);
    expect(await zoom(page)).toBeGreaterThan(before);
    await touch(session, 'touchEnd');
  });
}

test('movement of either finger cancels without rearming while held', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await touch(session, 'touchStart');
  await touch(session, 'touchMove', [initialTouches[0], { id: 2, x: 300, y: 200 }]);
  await page.waitForTimeout(400);
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchEnd');
});

test('one finger and three fingers do not measure', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await touch(session, 'touchStart', [initialTouches[0]]);
  await page.waitForTimeout(300);
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchStart');
  await touch(session, 'touchStart', [...initialTouches, { id: 3, x: 200, y: 300 }]);
  await page.waitForTimeout(300);
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchEnd');
});

test('desktop touch input keeps existing behavior', async ({ page, context }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const session = await context.newCDPSession(page);
  await touch(session, 'touchStart');
  await page.waitForTimeout(350);
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchMove', pinchedTouches);
  await expect.poll(() => zoom(page)).toBeGreaterThan(10);
});

test('touch cancellation clears the overlay and allows the next hold', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await touch(session, 'touchStart');
  await expect(overlay(page)).toBeVisible();
  await touch(session, 'touchCancel');
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchStart');
  await expect(overlay(page)).toBeVisible();
});

test('camera movement, resizing, and cleanup remove the measurement', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await touch(session, 'touchStart');
  await expect(overlay(page)).toBeVisible();
  await page.evaluate(() => (window as unknown as TestWindow).map.jumpTo({ zoom: 14 }));
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchEnd');
  await touch(session, 'touchStart');
  await expect(overlay(page).locator('text')).toHaveText(/^\d+ m$/);
  await page.setViewportSize({ width: 400, height: 844 });
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchEnd');
  await touch(session, 'touchStart');
  await page.evaluate(() => (window as unknown as TestWindow).removeMeasurement());
  await page.waitForTimeout(350);
  await expect(overlay(page)).toHaveCount(0);
});

test('Triplo mounts the gesture and a second finger cancels the waypoint long press', async ({ page, context }) => {
  await page.route('https://tiles.openfreemap.org/styles/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
  }));
  await page.route('https://www.googletagmanager.com/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore Triplo', exact: true }).click();
  await page.getByTitle('New Trip', { exact: true }).click();
  // New-trip setup may prompt again when exploring without cloud storage.
  const explore = page.getByRole('button', { name: 'Explore Triplo', exact: true });
  if (await explore.isVisible()) await explore.click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  const session = await context.newCDPSession(page);
  await touch(session, 'touchStart', [initialTouches[0]]);
  await page.waitForTimeout(100);
  await touch(session, 'touchStart');
  await expect(overlay(page)).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.locator('.context-menu')).toHaveCount(0);
  await touch(session, 'touchMove', pinchedTouches);
  await expect(overlay(page)).toHaveCount(0);
  await touch(session, 'touchEnd');
});
