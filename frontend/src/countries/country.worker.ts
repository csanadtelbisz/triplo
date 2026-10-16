import { bbox } from '@turf/turf';
import type { Trip } from '../../../shared/types';
import { GEOMETRY_VERSION, getEffectiveGeometry } from '../utils/effectiveGeometry';
import { CountryPartitioner, overlaps } from './partition';
import { COUNTRY_ALGORITHM_VERSION, segmentKey } from './types';
import type { Bounds, CountryAsset, CountryIndex, CountryResult } from './types';

const digest = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const textHash = (value: unknown) => digest(new TextEncoder().encode(JSON.stringify(value)));

async function database(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    const request = indexedDB.open('TriploCountryCache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('results');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function cached(db: IDBDatabase | null, key: string): Promise<CountryResult | undefined> {
  if (!db) return undefined;
  return new Promise(resolve => {
    const request = db.transaction('results').objectStore('results').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
}

async function asset(entry: CountryIndex['countries'][number], base: string): Promise<CountryAsset> {
  const response = await fetch(new URL(entry.file, base));
  if (!response.ok) throw new Error(`Cannot load boundaries for ${entry.name} (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (await digest(bytes) !== entry.sha256) throw new Error(`Boundary checksum mismatch for ${entry.name}`);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}

self.onmessage = async (event: MessageEvent<{ trips: Trip[]; base: string }>) => {
  const db = await database();
  try {
    const { trips, base } = event.data;
    const response = await fetch(new URL('index.json', base));
    if (!response.ok) throw new Error(`Cannot load the country catalog (${response.status})`);
    const index: CountryIndex = await response.json();
    const entries = await Promise.all(trips.flatMap(trip => trip.segments.map(async segment => {
      const geometry = getEffectiveGeometry(segment);
      const hash = await textHash([index.version, COUNTRY_ALGORITHM_VERSION, GEOMETRY_VERSION, segment.transportMode, segment.routingProfile, geometry, segment.waypoints.map(w => [w.id, w.coordinates])]);
      return { key: segmentKey(trip.id, segment.id), hash, segment, geometry, result: await cached(db, hash) };
    })));
    const pending = entries.filter(e => !e.result);
    const bounds = pending.filter(e => e.segment.transportMode !== 'flight' && e.segment.routingProfile !== 'teleport')
      .flatMap(e => e.geometry.coordinates.map(coordinates => bbox({ type: 'LineString', coordinates }) as Bounds));
    const candidates = index.countries.filter(country => country.bounds.some(b => bounds.some(route => overlaps(b, route))));
    const assets: CountryAsset[] = [];
    // Bound concurrent downloads and retain the detailed polygons only in this worker.
    for (let i = 0; i < candidates.length; i += 3) assets.push(...await Promise.all(candidates.slice(i, i + 3).map(entry => asset(entry, base))));
    const partitioner = new CountryPartitioner(assets);
    const results: Record<string, CountryResult> = {};
    for (const entry of entries) {
      const result = entry.result || partitioner.partition(entry.segment, entry.geometry);
      results[entry.key] = result;
      if (!entry.result && db) {
        try { db.transaction('results', 'readwrite').objectStore('results').put(result, entry.hash); } catch { /* Optional local cache. */ }
      }
    }
    self.postMessage({ data: { index, results } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally { db?.close(); }
};
