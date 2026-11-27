import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispose, parseMetadata, writeMetadata } from '@uswriting/exiftool';
import { expect, test } from '@playwright/test';

const fixtureDirectory = fileURLToPath(new URL('./fixtures/exiftool/', import.meta.url));
const supportedExtensions = new Set(['.heic', '.heif', '.jpg', '.jpeg', '.png', '.webp']);
const fixtures = (await readdir(fixtureDirectory)).filter(name => supportedExtensions.has(path.extname(name).toLowerCase()));
const wasmUrl = import.meta.resolve('@6over3/zeroperl-ts/zeroperl.wasm');
const wasmBytes = await readFile(wasmUrl.startsWith('file:') ? fileURLToPath(wasmUrl) : wasmUrl);
const testPosition = { lat: -33.8568, lon: 151.2153 };
const wasmFetch = async () => new Response(wasmBytes);
const browserGlobals = globalThis as unknown as { window?: unknown; document?: unknown };
browserGlobals.window ??= globalThis;
browserGlobals.document ??= {};

function readPosition(json: string) {
  const [metadata] = JSON.parse(json) as { GPSLatitude?: number | string; GPSLatitudeRef?: string; GPSLongitude?: number | string; GPSLongitudeRef?: string }[];
  const lat = Number(metadata?.GPSLatitude), lon = Number(metadata?.GPSLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat: metadata?.GPSLatitudeRef === 'S' ? -Math.abs(lat) : Math.abs(lat), lon: metadata?.GPSLongitudeRef === 'W' ? -Math.abs(lon) : Math.abs(lon) };
}

function makeImageFile(bytes: Uint8Array, fixture: string) {
  const signature = bytes.subarray(0, 12);
  const isJpeg = signature[0] === 0xff && signature[1] === 0xd8;
  const isHeif = new TextDecoder().decode(signature.subarray(4, 12)).includes('ftyp');
  const extension = isJpeg ? '.jpg' : isHeif ? '.heic' : path.extname(fixture);
  const name = `${path.basename(fixture, path.extname(fixture))}${extension}`;
  return new File([bytes], name, { type: isJpeg ? 'image/jpeg' : isHeif ? 'image/heic' : '' });
}

test.skip(fixtures.length === 0, 'Add real image fixtures under tests/fixtures/exiftool to enable these tests.');

test('ExifTool reads, writes, and reads GPS metadata for each image fixture', async () => {
  test.setTimeout(120_000);
  try {
    for (const fixture of fixtures) {
      const bytes = await readFile(path.join(fixtureDirectory, fixture));
      const file = makeImageFile(bytes, fixture);
      const before = await parseMetadata(file, { args: ['-json', '-n', '-GPS:all'], transform: data => data, fetch: wasmFetch });
      if (!before.success) throw new Error(`${fixture}: ${before.error}`);

      const output = await writeMetadata(file, {
        GPSLatitude: Math.abs(testPosition.lat), GPSLatitudeRef: testPosition.lat < 0 ? 'S' : 'N',
        GPSLongitude: Math.abs(testPosition.lon), GPSLongitudeRef: testPosition.lon < 0 ? 'W' : 'E',
      }, { args: ['-m'], fetch: wasmFetch });
      if (!output.success || !output.data) throw new Error(`${fixture}: ${output.error || 'GPS write failed'}`);

      const afterFile = new File([output.data], file.name, { type: file.type });
      const after = await parseMetadata(afterFile, { args: ['-json', '-n', '-GPS:all'], transform: data => data, fetch: wasmFetch });
      if (!after.success) throw new Error(`${fixture}: ${after.error}`);
      expect(output.data.byteLength, fixture).toBeGreaterThan(0);
      expect(readPosition(after.data)?.lat, fixture).toBeCloseTo(testPosition.lat, 5);
      expect(readPosition(after.data)?.lon, fixture).toBeCloseTo(testPosition.lon, 5);
    }
  } finally {
    await dispose();
  }
});
