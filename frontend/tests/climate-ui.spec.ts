import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function open(page: Page, seed = false) {
  if (seed) await page.addInitScript(() => {
    localStorage.setItem('climateProfiles', JSON.stringify([{ id: 'own-car', name: 'My car', profile: { mode: 'car', fuelType: 'petrol', exactFuelLPer100Km: 6, occupancy: 2 } }]));
    localStorage.setItem('builtInModeOverrides', JSON.stringify({ car: { climateProfileId: 'own-car' } }));
  });
  await page.goto('/tests/climate-app.html');
}
const dialog = (page: Page) => page.locator('.climate-dialog').last();
const climateCard = (page: Page) => page.locator('.trip-summary').filter({ has: page.getByRole('heading', { name: 'Climate Impact', exact: true }) });

test('automatic bus profiles show resolved defaults and change at the 10 km boundary', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('climate-test-trip')) return;
    localStorage.setItem('climate-test-trip', JSON.stringify({ id: 'bus', name: 'Bus trip', startDate: '2026-05-01', createdAt: '', updatedAt: '',
      segments: [{ id: 'car', transportMode: 'bus', routingProfile: 'straight', source: 'manual', waypoints: [],
        distanceStats: { totalDistance: 9.999, elevationUp: 0, elevationDown: 0, hasElevation: false }, countryDistances: { HU: 9.999 } }],
    }));
  });
  await open(page);
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  const card = climateCard(page);
  const busType = card.getByLabel('Bus type', { exact: true });
  await expect(busType).toBeDisabled();
  await expect(busType.locator('option:checked')).toHaveText('Automatic (Local)');
  await expect(card.locator('.climate-result')).toHaveText('1.6 kg CO₂e');
  await card.getByRole('radio', { name: 'Custom', exact: true }).check();
  await busType.selectOption('coach');
  await expect(card.locator('.climate-result')).toHaveText('0.5 kg CO₂e');
  await busType.selectOption('');
  await expect(card.locator('.climate-result')).toHaveText('1.6 kg CO₂e');
  await page.evaluate(() => {
    const trip = JSON.parse(localStorage.getItem('climate-test-trip')!);
    trip.segments[0].distanceStats.totalDistance = 10;
    trip.segments[0].countryDistances = { HU: 10 };
    localStorage.setItem('climate-test-trip', JSON.stringify(trip));
  });
  await page.reload();
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  await expect(busType.locator('option:checked')).toHaveText('Automatic (Coach)');
  await expect(card.locator('.climate-result')).toHaveText('0.5 kg CO₂e');
  await busType.selectOption('local');
  await expect(card.locator('.climate-result')).toHaveText('1.6 kg CO₂e');
  await busType.selectOption('');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('climate-test-trip')!).segments[0].climateProfile)).toEqual({ mode: 'bus' });
});

test('legacy unknown traction is shown as diesel and saved without the removed option', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('climateProfiles', JSON.stringify([
    { id: 'old-train', name: 'Old train', profile: { mode: 'rail', traction: 'unknown' } },
  ])));
  await open(page);
  await page.getByRole('button', { name: 'Edit Old train', exact: true }).click();
  const traction = dialog(page).getByLabel('Traction', { exact: true });
  await expect(traction).toHaveValue('diesel');
  expect(await traction.locator('option').allTextContents()).toEqual(['Electric', 'Diesel']);
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('climateProfiles')!)[0].profile.traction)).toBe('diesel');
});

test('electric rail types show distinct estimates and dated benchmark provenance', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  const card = climateCard(page);
  await card.getByRole('radio', { name: 'Custom', exact: true }).check();
  await card.getByLabel('Base algorithm', { exact: true }).selectOption('rail');
  await expect(card.locator('.climate-result')).toHaveText('2.4 kg CO₂e');
  await card.getByText('Calculation details', { exact: true }).click();
  await expect(card.getByText('Rail energy benchmark: 2017 (French transport reporting)', { exact: true })).toBeVisible();
  await expect(card.getByText(/Electric inter-city benchmark: 0.106 kWh/)).toBeVisible();
  await card.getByLabel('Rail type', { exact: true }).selectOption('high_speed');
  await expect(card.locator('.climate-result')).toHaveText('1.6 kg CO₂e');
  await expect(card.getByText(/Electric high-speed benchmark: 0.070 kWh/)).toBeVisible();
  await expect(card.getByText(/Direct: 0.00 kg CO₂e/)).toBeVisible();
  await card.getByText('Climate data and methodology', { exact: true }).click();
  await expect(card.getByRole('link', { name: 'French transport-reporting benchmarks (2017)' })).toHaveAttribute('href', 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000034554253');
});

test('named profiles, mode defaults, inherited values and overrides persist', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add climate profile', exact: true }).click();
  await dialog(page).getByLabel('Name', { exact: true }).fill('My car');
  await dialog(page).getByLabel('Fuel type', { exact: true }).selectOption('petrol');
  await dialog(page).getByLabel('Fuel consumption (L/100 km)', { exact: true }).fill('6');
  await dialog(page).getByLabel('Occupancy (people)', { exact: true }).fill('2');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  const profileId = await page.evaluate(() => JSON.parse(localStorage.getItem('climateProfiles')!)[0].id);
  await page.getByLabel('car default climate profile', { exact: true }).selectOption(profileId);
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  const card = climateCard(page);
  await expect(card.getByRole('radio', { name: 'Use transport mode default: My car', exact: true })).toBeChecked();
  await expect(card).toContainText('8.0 kg CO₂e');
  await expect(card.getByLabel('Base algorithm', { exact: true })).toBeDisabled();
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toHaveValue('2');
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toBeDisabled();
  await expect(card.getByLabel('Fuel consumption (L/100 km)', { exact: true })).toHaveValue('6');
  await card.getByRole('radio', { name: 'Custom', exact: true }).check();
  await expect(card.getByLabel('Base algorithm', { exact: true })).toHaveValue('car');
  await expect(card.getByLabel('Name', { exact: true })).toHaveCount(0);
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toHaveValue('2');
  await card.getByLabel('Occupancy (people)', { exact: true }).fill('');
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toHaveAttribute('placeholder', 'Automatic (1.5)');
  await card.getByLabel('Occupancy (people)', { exact: true }).fill('4');
  await expect(card).toContainText('4.0 kg CO₂e');
  await page.reload();
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  await expect(climateCard(page)).toContainText('4.0 kg CO₂e');
  await climateCard(page).getByRole('radio', { name: 'Use transport mode default: My car', exact: true }).check();
  await expect(climateCard(page)).toContainText('8.0 kg CO₂e');
  await page.getByLabel('Read only', { exact: true }).check();
  await expect(climateCard(page).getByRole('radio', { name: 'Custom', exact: true })).toBeDisabled();
});

test('trip custom defaults use unnamed dialogs and update summary, segments and analytics', async ({ page }) => {
  await open(page, true);
  await page.getByRole('button', { name: 'trip', exact: true }).click();
  await expect(page.getByText('Total Climate Impact:', { exact: true }).locator('..')).toContainText('8.0 kg CO₂e');
  await page.getByRole('button', { name: 'Trip climate profile defaults', exact: true }).click();
  await dialog(page).getByLabel('Car', { exact: true }).selectOption('custom');
  await expect(dialog(page).getByLabel('Name', { exact: true })).toHaveCount(0);
  await dialog(page).getByLabel('Base algorithm', { exact: true }).selectOption('bus');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Edit Car climate profile', exact: true }).click();
  await dialog(page).getByLabel('Bus type', { exact: true }).selectOption('local');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Trip climate profile defaults', exact: true })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Total Climate Impact:', { exact: true }).locator('..')).toContainText('4.6 kg CO₂e');
  await expect(page.getByRole('columnheader', { name: 'Climate impact', exact: true })).toHaveAttribute('title', 'Kilograms CO₂e per traveller');
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  await expect(climateCard(page)).toContainText('Use transport mode default: Car (trip default)');
  await expect(climateCard(page)).toContainText('4.6 kg CO₂e');
  await page.getByRole('button', { name: 'analytics', exact: true }).click();
  await expect(page.locator('.analytics-summary-rows')).toContainText('100.0');
  await page.getByRole('button', { name: 'Show climate impact', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Climate Impact per Year (kg CO₂e)', exact: true })).toBeVisible();
  await expect(page.locator('.analytics-summary-rows')).toContainText('4.6');
  await expect(page.getByRole('button', { name: 'Group by country', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Trip climate impacts', { exact: true })).toContainText('Climate trip');
  await page.getByRole('button', { name: 'Group by transport mode', exact: true }).click();
  await expect(page.locator('.analytics-summary-rows')).toContainText('car');
  await expect(page.locator('.analytics-summary-rows')).toContainText('4.6');
  await page.getByRole('button', { name: 'Show distance', exact: true }).click();
  await expect(page.locator('.analytics-summary-rows')).toContainText('100.0');
  await page.getByRole('button', { name: 'Group by country', exact: true }).click();
  await page.locator('.country-row').filter({ hasText: 'HU' }).click();
  await expect(page.locator('.analytics-summary-rows').last()).toContainText('75.0');
  await page.getByRole('button', { name: 'Show climate impact', exact: true }).click();
  await expect(page.locator('.country-row')).toHaveCount(0);
  await expect(page.locator('.analytics-summary-rows')).toContainText('4.6');
  await page.getByRole('button', { name: 'Show distance', exact: true }).click();
  await expect(page.locator('.analytics-summary-rows').last()).toContainText('75.0');
  await expect(page.getByRole('heading', { name: 'Distance per Year', exact: true })).toBeVisible();
});

test('shared editor exposes every algorithm without copying controls', async ({ page }) => {
  await open(page, true);
  await page.getByRole('button', { name: 'Add climate profile', exact: true }).click();
  const editor = dialog(page);
  await editor.getByLabel('Name', { exact: true }).fill('New profile');
  await expect(editor.getByLabel('Copy from:', { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('New profile');
  await editor.getByLabel('Fuel type', { exact: true }).selectOption('bev');
  await expect(editor.getByLabel('Electricity source', { exact: true })).toHaveCount(0);
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('rail');
  await expect(editor.getByLabel('Electricity source', { exact: true })).toHaveCount(0);
  expect(await editor.getByLabel('Rail type', { exact: true }).locator('option').allTextContents()).toEqual(['High speed', 'Inter city', 'Light rail', 'Subway']);
  await expect(editor.getByLabel('Traction', { exact: true })).toBeVisible();
  expect(await editor.getByLabel('Traction', { exact: true }).locator('option').allTextContents()).toEqual(['Electric', 'Diesel']);
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('bus');
  await expect(editor.getByLabel('Bus type', { exact: true }).locator('option:checked')).toHaveText('Automatic (Local below 10 km, Coach otherwise)');
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('flight');
  await editor.getByLabel('Aircraft type (ICAO)', { exact: true }).fill('A20N');
  await editor.getByLabel('Airline (ICAO)', { exact: true }).fill('RYR');
  await expect(editor.getByLabel('Passenger load factor (%)', { exact: true })).toHaveAttribute('placeholder', 'Automatic (aircraft average)');
  await editor.getByLabel('Passenger load factor (%)', { exact: true }).fill('90');
  await editor.getByLabel('Override seat configuration', { exact: true }).check();
  await expect(editor.getByLabel('Economy seats', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Premium economy seats', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Business seats', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('First seats', { exact: true })).toBeVisible();
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('ferry');
  await expect(editor.getByLabel('Travelling with a car', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('New profile', { exact: true })).toHaveCount(0);
});

test('cloud preferences restore named profiles and custom-mode associations', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const modulePath = '/src/utils/preferencesSync.ts';
    const { loadPreferencesFromCloud } = await import(modulePath);
    await loadPreferencesFromCloud({
      climateProfiles: [{ id: 'restored', name: 'Restored electric car', profile: { mode: 'car', fuelType: 'bev', occupancy: 2 } }],
      builtInModes: { car: { climateProfileId: 'restored' } },
      customModes: [{ icon: 'electric_car', name: 'Electric taxi', color: '#008800', routingProfile: 'Straight Line Router|straight_line', climateProfileId: 'restored' }],
    });
  });
  await expect(page.getByLabel('car default climate profile', { exact: true })).toHaveValue('restored');
  await expect(page.getByLabel('Electric taxi default climate profile', { exact: true })).toHaveValue('restored');
  await page.reload();
  await expect(page.getByLabel('Electric taxi default climate profile', { exact: true })).toHaveValue('restored');
  await page.getByRole('button', { name: 'Edit Restored electric car', exact: true }).click();
  await expect(dialog(page).getByLabel('Name', { exact: true })).toHaveValue('Restored electric car');
  await dialog(page).getByLabel('Name', { exact: true }).fill('Renamed electric car');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  await expect(climateCard(page)).toContainText('Use transport mode default: Renamed electric car');
});

test('profile table reorders persistently and transport defaults share form styling in both themes', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('climateProfiles')) localStorage.setItem('climateProfiles', JSON.stringify([
      { id: 'own-car', name: 'My car', profile: { mode: 'car' } },
      { id: 'train', name: 'Fast train', profile: { mode: 'rail', railType: 'high_speed' } },
    ]));
  });
  await open(page);
  const table = page.locator('.climate-profiles-table');
  await expect(table.getByRole('button', { name: 'Move My car up', exact: true })).toBeDisabled();
  await table.getByRole('button', { name: 'Move My car down', exact: true }).click();
  expect((await table.locator('tr > td:first-child').allTextContents()).slice(0, -1)).toEqual(['Fast train', 'My car']);
  await page.reload();
  await expect(table.locator('tr').first()).toContainText('Fast train');
  await table.getByRole('button', { name: 'Delete Fast train', exact: true }).click();
  await expect(table.locator('tr')).toHaveCount(2);
  expect(await page.locator('.climate-preferences').evaluate(element => element.firstElementChild?.tagName)).toBe('DETAILS');

  const car = page.getByLabel('car default climate profile', { exact: true });
  await expect(car).toHaveValue('builtin:car');
  await expect(page.getByLabel('walk default climate profile', { exact: true })).toHaveValue('builtin:none');
  await expect(page.getByLabel('subway default climate profile', { exact: true })).toHaveValue('builtin:rail');
  expect(await car.locator('option').allTextContents()).toEqual(['Car [built-in]', 'Bus [built-in]', 'Rail [built-in]', 'Flight [built-in]', 'Ferry [built-in]', 'No emission', 'My car']);
  const row = car.locator('xpath=ancestor::tr');
  const name = row.getByTitle('Override Name', { exact: true });
  const icon = row.getByTitle('System Icon (Cannot be changed)', { exact: true });
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.body.classList.toggle('dark-mode', dark), dark);
    const border = await car.evaluate(element => getComputedStyle(element).borderColor);
    await expect(name).toHaveCSS('border-color', border);
    await expect(icon).toHaveCSS('border-color', border);
    await expect(row.getByTitle('Override Default Routing Profile', { exact: true })).toHaveCSS('background-color', await car.evaluate(element => getComputedStyle(element).backgroundColor));
    await expect(name).toHaveCSS('font-size', await car.evaluate(element => getComputedStyle(element).fontSize));
    await expect(icon).toHaveCSS('background-color', dark ? 'rgb(37, 42, 48)' : 'rgb(245, 245, 245)');
  }
  await car.selectOption('builtin:bus');
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  const card = climateCard(page);
  await expect(card).toContainText('Use transport mode default: Bus [built-in]');
  await expect(card).toContainText('4.6 kg CO₂e');
  await card.getByText('Calculation details', { exact: true }).click();
  await expect(card.getByLabel('About direct emissions', { exact: true })).toBeVisible();
  await expect(card.getByLabel('About upstream emissions', { exact: true })).toBeVisible();
  await expect(card.locator('.climate-details')).toHaveCSS('font-size', await card.locator('.climate-attribution').evaluate(element => getComputedStyle(element).fontSize));
  await expect(card.locator('.climate-result')).not.toContainText('per traveller');
});

test('climate analytics sort trips, omit zero-impact modes, and use neutral metric icons', async ({ page }) => {
  await page.addInitScript(() => {
    const makeTrip = (id: string, name: string, mode: 'bus' | 'walk' | 'other', km: number) => ({
      id, name, startDate: '2026-05-01', endDate: '2026-05-01', createdAt: '2026-05-01', updatedAt: '',
      tripDistanceSummary: { totalDistance: km, distanceByMode: { [mode === 'other' ? 'other:airport_shuttle' : mode]: km } },
      segments: [{ id, name, transportMode: mode, customIcon: mode === 'other' ? 'airport_shuttle' : undefined,
        climateProfile: mode === 'other' ? { mode: 'bus' } : undefined,
        routingProfile: 'straight_line', routingService: 'Straight Line Router', source: 'manual', waypoints: [],
        distanceStats: { totalDistance: km, hasElevation: false, elevationUp: 0, elevationDown: 0 },
      }],
    });
    localStorage.setItem('climate-test-additional-trips', JSON.stringify([
      makeTrip('bus', 'Bus journey', 'bus', 300), makeTrip('walk', 'Walking holiday', 'walk', 100), makeTrip('tiny', 'Tiny shuttle', 'other', .01),
    ]));
  });
  await open(page, true);
  await page.getByRole('button', { name: 'analytics', exact: true }).click();
  const distanceIcon = page.getByRole('button', { name: 'Show climate impact', exact: true });
  await expect(distanceIcon).toHaveText('straighten');
  const color = await distanceIcon.evaluate(element => getComputedStyle(element).color);
  await distanceIcon.click();
  await page.getByRole('heading', { name: 'Analytics', exact: true }).hover();
  const climateIcon = page.getByRole('button', { name: 'Show distance', exact: true });
  await expect(climateIcon).toHaveText('eco');
  await expect(climateIcon).toHaveCSS('color', color);
  await expect(climateIcon).not.toHaveClass(/active/);
  const rows = page.getByLabel('Trip climate impacts', { exact: true }).locator('.analytics-summary-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Bus journey');
  await expect(rows.nth(1)).toContainText('Climate trip');
  await expect(page.getByRole('button', { name: 'Group by transport mode', exact: true })).toHaveText('route');
  await page.getByRole('button', { name: 'Group by transport mode', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Group by trip', exact: true })).toHaveText('commute');
  await expect(page.locator('.analytics-summary-row')).toHaveCount(2);
  await expect(page.locator('.analytics-summary-rows')).not.toContainText('Walk');
  await expect(page.locator('.analytics-summary-rows')).not.toContainText('airport_shuttle');
  await page.locator('.analytics-summary-row').filter({ hasText: /bus/i }).click();
  await expect(page.getByRole('heading', { name: 'bus Segments', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Group by trip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'bus Segments', exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(4);
});

test('built-in defaults are visible and flight placeholders and details show relevant defaults and years', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  const card = climateCard(page);
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toHaveValue('1.5');
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toBeDisabled();
  await card.getByRole('radio', { name: 'Custom', exact: true }).check();
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toBeEnabled();
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toHaveValue('');
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toHaveAttribute('placeholder', 'Automatic (1.5)');
  await card.getByLabel('Fuel type', { exact: true }).selectOption('petrol');
  await expect(card.getByLabel('Fuel consumption (L/100 km)', { exact: true })).toHaveAttribute('placeholder', 'Automatic (DEFRA average)');
  await card.getByLabel('Base algorithm', { exact: true }).selectOption('flight');
  await expect(card.getByLabel('Aircraft type (ICAO)', { exact: true })).toHaveAttribute('placeholder', 'Automatic (DEFRA average)');
  await card.getByLabel('Aircraft type (ICAO)', { exact: true }).fill('A20N');
  await expect(card.getByLabel('Passenger load factor (%)', { exact: true })).toHaveAttribute('placeholder', 'Automatic (75%)');
  await card.getByText('Calculation details', { exact: true }).click();
  await expect(card.locator('.climate-details')).toContainText('Aircraft table: 2026');
  await expect(card.locator('.climate-details')).not.toContainText('factors:2015');
  await page.getByLabel('Read only', { exact: true }).check();
  await expect(card.getByLabel('Passenger load factor (%)', { exact: true })).toBeDisabled();
  await expect(card.getByLabel('Passenger load factor (%)', { exact: true })).toHaveValue('75');
});
