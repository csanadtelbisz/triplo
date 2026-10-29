import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Trip } from '../../shared/types';

async function newTrip(page: Page, failSave = false) {
  const uploads: Trip[] = [];
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.addInitScript(() => {
    localStorage.setItem('github_token', 'test-token');
    localStorage.setItem('github_repo', 'test/trips');
    localStorage.setItem('startMinimized', 'false');
  });
  await page.route('https://api.github.com/**', route => {
    const request = route.request();
    if (request.method() === 'PUT' && request.url().includes('/contents/trips/')) {
      uploads.push(JSON.parse(Buffer.from(request.postDataJSON().content, 'base64').toString('utf8')));
      return route.fulfill(failSave ? { status: 500, json: { message: 'Upload failed' } } : { json: { content: { sha: 'saved' } } });
    }
    return route.fulfill({ status: request.url().endsWith('/contents/trips') ? 200 : 404, json: request.url().endsWith('/contents/trips') ? [] : {} });
  });
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('**/countries/index.json', route => route.fulfill({ json: { version: 'empty', countries: [], attribution: 'Test' } }));
  await page.goto('/tests/country-app.html');
  await page.getByTitle('New Trip', { exact: true }).click();
  await page.locator('.title-input').fill('Unsaved browser trip');
  await page.locator('.title-input').blur();
  await expect.poll(() => page.evaluate(() => history.state?.triploPanel?.tripId)).toMatch(/^temp_trip_/);
  return uploads;
}

const unsavedDialog = (page: Page) => page.locator('.dialog-content').filter({ has: page.getByRole('heading', { name: 'Unsaved Trip', exact: true }) });

for (const navigation of ['browser', 'panel']) test(`${navigation} Back prompts before discarding a new trip and dismissal preserves it`, async ({ page }) => {
  const uploads = await newTrip(page);
  const entry = await page.evaluate(() => history.state.triploHistoryId);
  const back = async () => {
    if (navigation === 'browser') await page.goBack();
    else await page.locator('.toolbar button').first().click();
    await expect(unsavedDialog(page)).toBeVisible();
  };
  await back();
  await page.keyboard.press('Escape');
  await expect(unsavedDialog(page)).toHaveCount(0);
  await expect(page.locator('.title-input')).toHaveValue('Unsaved browser trip');
  expect(await page.evaluate(() => history.state.triploHistoryId)).toBe(entry);
  await back();
  await unsavedDialog(page).getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByTitle('New Trip', { exact: true })).toBeVisible();
  await expect(page.locator('.title-input')).toHaveCount(0);
  expect(uploads).toHaveLength(0);
});

test('browser Back can save and exit a new trip; saved trips do not prompt', async ({ page }) => {
  const uploads = await newTrip(page);
  await page.goBack();
  await unsavedDialog(page).getByRole('button', { name: 'Save & Exit', exact: true }).click();
  await expect(page.getByTitle('New Trip', { exact: true })).toBeVisible();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].name).toBe('Unsaved browser trip');
  expect(uploads[0].id).not.toMatch(/^temp_trip_/);
  await page.locator('.trip-card').filter({ hasText: 'Unsaved browser trip' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Unsaved browser trip');
  await page.goBack();
  await expect(page.getByTitle('New Trip', { exact: true })).toBeVisible();
  await expect(unsavedDialog(page)).toHaveCount(0);
});

test('a failed Save & Exit keeps the unsaved trip and dialog open', async ({ page }) => {
  await newTrip(page, true);
  await page.goBack();
  const failure = page.waitForEvent('dialog');
  await unsavedDialog(page).getByRole('button', { name: 'Save & Exit', exact: true }).click();
  const alert = await failure;
  expect(alert.message()).toBe('Failed to save trip');
  await alert.accept();
  await expect(unsavedDialog(page)).toBeVisible();
  await expect(page.locator('.title-input')).toHaveValue('Unsaved browser trip');
  await page.keyboard.press('Escape');
  await page.goBack();
  await expect(unsavedDialog(page)).toBeVisible();
});

test('browser Back within a new trip preserves it and prompts only when leaving the trip', async ({ page }) => {
  await newTrip(page);
  const editorEntry = await page.evaluate(() => history.state.triploHistoryId);
  await page.getByTitle('Segment Info', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Segment Info', exact: true })).toBeVisible();
  // Panel rendering can precede the effect that writes its history entry.
  // Wait for that entry before starting another browser traversal.
  await expect.poll(() => page.evaluate(() => history.state?.triploPanel?.panel)).toBe('segment');
  await page.goBack();
  await expect.poll(() => page.evaluate(() => history.state?.triploHistoryId)).toBe(editorEntry);
  await expect(page.locator('.title-input')).toHaveValue('Unsaved browser trip');
  await expect(unsavedDialog(page)).toHaveCount(0);
  await page.goBack();
  await expect(unsavedDialog(page)).toBeVisible();
});
