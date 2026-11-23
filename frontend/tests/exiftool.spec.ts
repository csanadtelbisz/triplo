import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/exiftool/', import.meta.url));
const supportedExtensions = new Set(['.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp']);
const fixtures = (await readdir(fixtureDirectory)).filter(name => supportedExtensions.has(path.extname(name).toLowerCase()));
const testPosition = { lat: -33.8568, lon: 151.2153 };

test.describe('ExifTool metadata round trip', () => {
  test.skip(fixtures.length === 0, 'Add real image fixtures under tests/fixtures/exiftool to enable these tests.');

  for (const fixture of fixtures) {
    test(`${fixture}: read, write GPS, and read it back`, async ({ page }) => {
      await page.goto('/tests/persisting-services.html');
      const result = await page.evaluate(async ({ fixtureName, coordinates }) => {
        const { readGps, writeGps, editedPhotoFile } = await import('/src/native/exiftool/index.ts');
        const response = await fetch(`/tests/fixtures/exiftool/${encodeURIComponent(fixtureName)}`);
        if (!response.ok) throw new Error(`Could not load fixture (${response.status})`);
        const data = await response.arrayBuffer();
        const signature = new Uint8Array(data, 0, Math.min(12, data.byteLength));
        const isJpeg = signature[0] === 0xff && signature[1] === 0xd8;
        const isHeif = new TextDecoder().decode(signature.slice(4, 12)).includes('ftyp');
        const extension = isJpeg ? '.jpg' : isHeif ? '.heic' : fixtureName.slice(fixtureName.lastIndexOf('.'));
        const name = `${fixtureName.slice(0, fixtureName.lastIndexOf('.'))}${extension}`;
        const original = new File([data], name, { type: isJpeg ? 'image/jpeg' : isHeif ? 'image/heic' : response.headers.get('content-type') || '' });
        const before = await readGps(original);
        const output = await writeGps(original, coordinates);
        const after = await readGps(editedPhotoFile(original, output));
        return { before, after, outputSize: output.byteLength };
      }, { fixtureName: fixture, coordinates: testPosition });

      expect(result.outputSize).toBeGreaterThan(0);
      expect(result.after?.lat).toBeCloseTo(testPosition.lat, 5);
      expect(result.after?.lon).toBeCloseTo(testPosition.lon, 5);
    });
  }
});
