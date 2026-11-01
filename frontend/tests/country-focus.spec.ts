import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { countryFocusBounds } from '../src/countries/focusBounds';
import type { Bounds, CountryIndex } from '../src/countries/types';

const index: CountryIndex = JSON.parse(readFileSync(new URL('../public/countries/index.json', import.meta.url), 'utf8'));
const parts = (code: string) => index.countries.find(country => country.code === code)!.landParts!;
const encloses = (bounds: Bounds, coordinate: number[]) => coordinate[0] >= bounds[0] && coordinate[0] <= bounds[2]
  && coordinate[1] >= bounds[1] && coordinate[1] <= bounds[3];

test('Denmark includes Copenhagen by default and Bornholm only when visited', () => {
  const bounds = countryFocusBounds(parts('DK'), [[9.5, 56.2]])!;
  expect(encloses(bounds, [12.57, 55.68])).toBe(true);
  expect(encloses(bounds, [14.92, 55.1])).toBe(false);
  expect(countryFocusBounds(parts('DK'), [[12.57, 55.68]])).toEqual(bounds);
  const withVisit = countryFocusBounds(parts('DK'), [[9.5, 56.2], [14.92, 55.1]])!;
  expect(encloses(withVisit, [9.5, 56.2])).toBe(true);
  expect(encloses(withVisit, [12.57, 55.68])).toBe(true);
  expect(encloses(withVisit, [14.92, 55.1])).toBe(true);
});

test('Italy includes Sicily and Sardinia even when route points favor Sicily', () => {
  const mainland = countryFocusBounds(parts('IT'), [[12.5, 41.9]])!;
  expect(encloses(mainland, [13.36, 38.12])).toBe(true);
  expect(encloses(mainland, [9.12, 39.22])).toBe(true);
  expect(countryFocusBounds(parts('IT'), [[13.36, 38.12]])).toEqual(mainland);
});

for (const { code, mainland, island } of [
  { code: 'ES', mainland: [-3.7, 40.4], island: [-16.3, 28.46] },
  { code: 'US', mainland: [-74, 40.7], island: [-157.85, 21.3] },
]) {
  test(`${code} excludes distant islands until visible trip points lift the 200 km cap`, () => {
    const landParts = parts(code);
    const snapshot = JSON.stringify(landParts);
    expect(encloses(countryFocusBounds(landParts, [mainland])!, island)).toBe(false);
    const withVisit = countryFocusBounds(landParts, [mainland, island])!;
    expect(encloses(withVisit, mainland)).toBe(true);
    expect(encloses(withVisit, island)).toBe(true);
    expect(countryFocusBounds(landParts, [island])).toEqual(withVisit);
    // Filtering out that visit returns to the default capped bounds.
    expect(encloses(countryFocusBounds(landParts, [mainland])!, island)).toBe(false);
    expect(JSON.stringify(landParts)).toBe(snapshot);
  });
}

test('the 200 km cap excludes unvisited land between 200 and 500 km away', () => {
  const landParts: Bounds[] = [[0, 0, 10, 1], [11, 0, 11.5, 0.5], [13, 0, 13.5, 0.5]];
  expect(countryFocusBounds(landParts, [[5, 0.5]])).toEqual([0, 0, 11.5, 1]);
  expect(countryFocusBounds(landParts, [[5, 0.5], [13.25, 0.25]])).toEqual([0, 0, 13.5, 1]);
});

test('a remote visit lifts the cap for the group without exceeding the original diameter', () => {
  const mainland: Bounds = [0, 0, 10, 1];
  const visitedIsland: Bounds = [16, 0, 17, 1];
  const unvisitedIsland: Bounds = [18, 0, 19, 1];
  const tooFar: Bounds = [22, 0, 23, 1];
  const landParts = [mainland, visitedIsland, unvisitedIsland, tooFar];
  expect(countryFocusBounds(landParts, [[5, 0.5]])).toEqual(mainland);
  expect(countryFocusBounds(landParts, [[5, 0.5], [16.5, 0.5]])).toEqual([0, 0, 19, 1]);
  expect(countryFocusBounds(landParts, [[22.5, 0.5]])).toEqual(tooFar);
});

test('small landmasses use their diameter even when it is below 200 km; groups do not chain', () => {
  const landParts: Bounds[] = [[0, 0, 1, 1], [2, 0, 2.2, 0.2], [3, 0, 3.1, 0.1]];
  expect(countryFocusBounds(landParts, [[0.5, 0.5], [3.05, 0.05]])).toEqual([0, 0, 2.2, 1]);
});

test('longitude distances use latitude and wrap at the antimeridian', () => {
  const highLatitude: Bounds[] = [[0, 60, 1, 61], [3, 60, 3.2, 60.2]];
  expect(countryFocusBounds(highLatitude, [[0.5, 60.5]])).toEqual([0, 60, 3.2, 61]);
  const dateline: Bounds[] = [[178, -1, 180, 1], [-180, -0.5, -179, 0.5]];
  expect(countryFocusBounds(dateline, [[-179.5, 0]])).toEqual([178, -1, 181, 1]);
});

test('empty, legacy single-box, and world-spanning inputs preserve fallback behavior', () => {
  expect(countryFocusBounds([], [[0, 0]])).toBeUndefined();
  const mainland: Bounds = [0, 0, 1, 1];
  expect(countryFocusBounds([mainland], [[0.5, 0.5]])).toEqual(mainland);
  expect(countryFocusBounds([mainland], [])).toEqual(mainland);
  const world: Bounds = [-180, -60, 180, 70];
  expect(countryFocusBounds([world], [[0, 0]])).toEqual(world);
});
