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

test('named profiles, mode defaults, inline copies and overrides persist', async ({ page }) => {
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
  await card.getByRole('radio', { name: 'Custom', exact: true }).check();
  await expect(card.getByLabel('Base algorithm', { exact: true })).toHaveValue('car');
  await expect(card.getByLabel('Name', { exact: true })).toHaveCount(0);
  await card.getByLabel('Copy from:', { exact: true }).selectOption(profileId);
  await card.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(card.getByLabel('Occupancy (people)', { exact: true })).toHaveValue('2');
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
  await page.getByRole('button', { name: 'Trip climate defaults', exact: true }).click();
  await dialog(page).getByLabel('Car', { exact: true }).selectOption('custom');
  await expect(dialog(page).getByLabel('Name', { exact: true })).toHaveCount(0);
  await dialog(page).getByLabel('Base algorithm', { exact: true }).selectOption('bus');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Edit Car climate profile', exact: true }).click();
  await dialog(page).getByLabel('Bus type', { exact: true }).selectOption('local');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Trip climate defaults', exact: true })).toBeVisible();
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
  await page.getByRole('button', { name: 'Group by country', exact: true }).click();
  await expect(page.locator('.country-row').filter({ hasText: 'HU' })).toContainText('3.5');
  await page.locator('.country-row').filter({ hasText: 'HU' }).click();
  await expect(page.locator('.analytics-summary-rows').last()).toContainText('3.5');
  await page.getByRole('button', { name: 'Show climate impact', exact: true }).click();
  await expect(page.locator('.analytics-summary-rows').last()).toContainText('75.0');
  await expect(page.getByRole('heading', { name: 'Distance per Year', exact: true })).toBeVisible();
});

test('shared editor exposes every algorithm and Copy preserves the profile name', async ({ page }) => {
  await open(page, true);
  await page.getByRole('button', { name: 'Add climate profile', exact: true }).click();
  const editor = dialog(page);
  await editor.getByLabel('Name', { exact: true }).fill('New profile');
  await editor.getByLabel('Copy from:', { exact: true }).selectOption('own-car');
  await editor.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('New profile');
  await editor.getByLabel('Fuel type', { exact: true }).selectOption('bev');
  await editor.getByLabel('Electricity source', { exact: true }).selectOption('custom');
  await editor.getByLabel('Electricity country', { exact: true }).selectOption('HUN');
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('rail');
  await expect(editor.getByLabel('Rail type', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Traction', { exact: true })).toBeVisible();
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('flight');
  await editor.getByLabel('Aircraft type (ICAO)', { exact: true }).fill('A20N');
  await editor.getByLabel('Airline (ICAO)', { exact: true }).fill('RYR');
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
