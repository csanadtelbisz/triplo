import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Segment, Trip } from '../../shared/types';
import { defaultData } from '../../climate/src/generated/data';
import { countFlightProfileUsage, flightProfileHints } from '../src/climate/flightHints';
import type { ClimateSettings } from '../src/climate/profiles';
import { segmentKey } from '../src/countries/types';
import { serializeTrip } from '../src/utils/serializeTrip';

const settings: ClimateSettings = { profiles: [], builtIn: {}, custom: [] };
const emptyUsage = () => ({ aircraft: new Map<string, number>(), airlines: new Map<string, number>() });
const flight = (id: string, operator: string, aircraftType: string): Segment => ({
  id, transportMode: 'flight', routingProfile: 'straight', source: 'manual', waypoints: [],
  climateProfile: { mode: 'flight', operator, aircraftType },
});
const trip = (id: string, segments: Segment[]): Trip => ({ id, name: id, createdAt: '', updatedAt: '', segments });
const codes = (hints: { code: string }[]) => hints.map(hint => hint.code);

test('empty flight hints restrict both directions to known operator layouts', () => {
  const aircraft = flightProfileHints({ mode: 'flight', operator: 'ryr' }, emptyUsage()).aircraft;
  expect(codes(aircraft).sort()).toEqual(['A320', 'B38M', 'B738']);
  const airlines = flightProfileHints({ mode: 'flight', aircraftType: 'a321' }, emptyUsage()).airlines;
  expect(codes(airlines).sort()).toEqual([...new Set(defaultData.layouts.filter(layout => layout.aircraft === 'A321').map(layout => layout.operator))].sort());
  expect(codes(airlines)).not.toContain('RYR');
  expect(codes(airlines)).toContain('WZZ');
});

test('typing searches all codes and names with compatible pairings ahead of frequency', () => {
  const usage = { aircraft: new Map([['B77W', 99]]), airlines: new Map([['RYR', 99]]) };
  const aircraft = flightProfileHints({ mode: 'flight', operator: 'RYR', aircraftType: 'b7' }, usage).aircraft;
  expect(codes(aircraft)[0]).toBe('B738');
  expect(codes(aircraft)).toContain('B77W');
  expect(aircraft.every(hint => hint.code.includes('B7') || hint.name.toUpperCase().includes('B7'))).toBe(true);
  const names = flightProfileHints({ mode: 'flight', operator: 'RYR', aircraftType: 'airbus' }, usage).aircraft;
  expect(codes(names)[0]).toBe('A320');
  expect(codes(names)).toContain('A321');
  const airlines = flightProfileHints({ mode: 'flight', aircraftType: 'A321', operator: 'air' }, usage).airlines;
  expect(codes(airlines)).toContain('RYR');
  expect(codes(airlines).indexOf('WZZ')).toBeLessThan(codes(airlines).indexOf('RYR'));
  expect(airlines.every(hint => hint.code.includes('AIR') || hint.name.toUpperCase().includes('AIR'))).toBe(true);
});

test('catalog includes layout-only entries and allows searching beyond missing fleet data', () => {
  const data = { ...defaultData, operators: { SOLO: { name: 'Solo Airline' } },
    layouts: [{ ...defaultData.layouts[0], operator: 'LAY', aircraft: 'EXTRA' }] };
  expect(flightProfileHints({ mode: 'flight', operator: 'LAY' }, emptyUsage(), data).aircraft).toEqual([{ code: 'EXTRA', name: 'EXTRA' }]);
  expect(flightProfileHints({ mode: 'flight', aircraftType: 'EXTRA' }, emptyUsage(), data).airlines).toEqual([{ code: 'LAY', name: 'LAY' }]);
  expect(flightProfileHints({ mode: 'flight', operator: 'SOLO' }, emptyUsage(), data).aircraft).toEqual([]);
  expect(codes(flightProfileHints({ mode: 'flight', operator: 'SOLO', aircraftType: 'A32' }, emptyUsage(), data).aircraft)).toContain('A321');
  expect(flightProfileHints({ mode: 'flight', operator: 'UNKNOWN' }, emptyUsage(), data).aircraft.length).toBeGreaterThan(0);
  expect(flightProfileHints({ mode: 'flight', aircraftType: 'A321', operator: 'solo' }, emptyUsage(), data).airlines).toEqual([{ code: 'SOLO', name: 'Solo Airline' }]);
});

test('usage counts effective segment profiles across trips, excludes the edited segment and changes no saved content', () => {
  const preferred: ClimateSettings = { ...settings, profiles: [{ id: 'usual', name: 'Usual flight', profile: { mode: 'flight', operator: 'RYR', aircraftType: 'B738' } }], builtIn: { flight: { climateProfileId: 'usual' } } };
  const inherited = { ...flight('same', '', ''), climateProfile: undefined };
  const first = trip('first', [inherited, flight('custom', 'thy', 'b77w'), { ...flight('not-flight', 'RYR', 'B738'), climateProfile: { mode: 'car' } }]);
  const second: Trip = { ...trip('second', [inherited, flight('override', 'RYR', 'B738')]), climateProfiles: { flight: { custom: { mode: 'flight', operator: 'WZZ', aircraftType: 'A321' } } } };
  const trips = [first, second];
  const before = trips.map(serializeTrip);
  const usage = countFlightProfileUsage(trips, preferred, segmentKey('first', 'same'));
  expect([...usage.airlines].sort()).toEqual([['RYR', 1], ['THY', 1], ['WZZ', 1]]);
  expect([...usage.aircraft].sort()).toEqual([['A321', 1], ['B738', 1], ['B77W', 1]]);
  expect(trips.map(serializeTrip)).toEqual(before);
  const all = countFlightProfileUsage(trips, preferred);
  expect(codes(flightProfileHints({ mode: 'flight' }, all).airlines)[0]).toBe('RYR');
  expect(codes(flightProfileHints({ mode: 'flight' }, all).aircraft)[0]).toBe('B738');
  expect(flightProfileHints({ mode: 'flight', operator: 'no matches' }, all).airlines).toEqual([]);
});

const history = trip('history', [
  ...Array.from({ length: 4 }, (_, i) => flight(`ryr-${i}`, 'RYR', 'B738')),
  ...Array.from({ length: 3 }, (_, i) => flight(`thy-${i}`, 'THY', 'B77W')),
  flight('wizz', 'WZZ', 'A321'),
]);
async function open(page: Page) {
  await page.addInitScript(history => localStorage.setItem('climate-test-additional-trips', JSON.stringify([history])), history);
  await page.goto('/tests/climate-app.html');
}
async function options(editor: Locator, label: string) {
  return editor.getByLabel(label, { exact: true }).evaluate(element => Array.from((element as HTMLInputElement).list?.options || [], option => option.value));
}

test('segment hints filter both directions and expand on code/name searches without clearing the other field', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'segment', exact: true }).click();
  const card = page.locator('.trip-summary').filter({ has: page.getByRole('heading', { name: 'Climate Impact', exact: true }) });
  await card.getByRole('radio', { name: 'Custom', exact: true }).check();
  await card.getByLabel('Base algorithm', { exact: true }).selectOption('flight');
  const aircraft = card.getByLabel('Aircraft type (ICAO)', { exact: true });
  const airline = card.getByLabel('Airline (ICAO)', { exact: true });
  expect((await options(card, 'Aircraft type (ICAO)'))[0]).toBe('B738');
  expect((await options(card, 'Airline (ICAO)'))[0]).toBe('RYR');
  await airline.fill('RYR');
  expect(await options(card, 'Aircraft type (ICAO)')).toEqual(['B738', 'A320', 'B38M']);
  await aircraft.fill('b7');
  expect((await options(card, 'Aircraft type (ICAO)'))[0]).toBe('B738');
  expect(await options(card, 'Aircraft type (ICAO)')).toContain('B77W');
  await aircraft.fill('airbus');
  expect((await options(card, 'Aircraft type (ICAO)'))[0]).toBe('A320');
  expect(await options(card, 'Aircraft type (ICAO)')).toContain('A321');
  await aircraft.fill('A321');
  await airline.fill('');
  expect(await options(card, 'Airline (ICAO)')).toContain('WZZ');
  expect(await options(card, 'Airline (ICAO)')).not.toContain('RYR');
  await airline.fill('air');
  const matches = await options(card, 'Airline (ICAO)');
  expect(matches.indexOf('WZZ')).toBeLessThan(matches.indexOf('RYR'));
  await airline.fill('RYR');
  await expect(aircraft).toHaveValue('A321');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('climate-test-trip')!).segments[0].climateProfile)).toMatchObject({ operator: 'RYR', aircraftType: 'A321' });
});

test('preference and trip dialogs use the same usage-ranked flight hints through portals', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add climate profile', exact: true }).click();
  let editor = page.locator('.climate-dialog').last();
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('flight');
  expect((await options(editor, 'Airline (ICAO)'))[0]).toBe('RYR');
  expect((await options(editor, 'Aircraft type (ICAO)'))[0]).toBe('B738');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'trip', exact: true }).click();
  await page.getByRole('button', { name: 'Trip climate profile defaults', exact: true }).click();
  await page.getByLabel('Car', { exact: true }).selectOption('custom');
  editor = page.locator('.climate-dialog').last();
  await editor.getByLabel('Base algorithm', { exact: true }).selectOption('flight');
  expect((await options(editor, 'Airline (ICAO)'))[0]).toBe('RYR');
  await editor.getByLabel('Airline (ICAO)', { exact: true }).fill('RYR');
  expect(await options(editor, 'Aircraft type (ICAO)')).toEqual(['B738', 'A320', 'B38M']);
});
