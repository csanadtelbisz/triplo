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
  const url = new URL(entry.file, base);
  url.searchParams.set('v', entry.sha256);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load boundaries for ${entry.name} (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (await digest(bytes) !== entry.sha256) throw new Error(`Boundary checksum mismatch for ${entry.name}`);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const country: CountryAsset = await new Response(stream).json();
  return { code: country.code, territorial: country.territorial, land: country.territorial };
}

self.onmessage = async (event: MessageEvent<{ trips: Trip[]; base: string }>) => {
  const db = await database();
  try {
    const { trips, base } = event.data;
    const response = await fetch(new URL('index.json', base), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Cannot load the country catalog (${response.status})`);
    const index: CountryIndex = await response.json();
    const entries = await Promise.all(trips.flatMap(trip => trip.segments.map(async segment => {
      const geometry = getEffectiveGeometry(segment);
      const hash = await textHash([index.version, COUNTRY_ALGORITHM_VERSION, GEOMETRY_VERSION, segment.transportMode, segment.routingProfile, geometry, segment.waypoints.map(w => [w.id, w.coordinates])]);
      const allowCache = !trip.metadata?.isSharedTripReference && !trip.metadata?.sharedService;
      return { key: segmentKey(trip.id, segment.id), hash, segment, geometry, allowCache, result: allowCache ? await cached(db, hash) : undefined };
    })));
    const results: Record<string, CountryResult> = {};
    const groups = new Map<string, { candidates: CountryIndex['countries']; entries: typeof entries }>();
    for (const entry of entries) {
      if (entry.result) { results[entry.key] = entry.result; continue; }
      const bounds = entry.segment.transportMode === 'flight' || entry.segment.routingProfile === 'teleport' ? []
        : entry.geometry.coordinates.map(coordinates => bbox({ type: 'LineString', coordinates }) as Bounds);
      const candidates = index.countries.filter(country => country.bounds.some(b => bounds.some(route => overlaps(b, route))));
      const key = candidates.map(c => c.code).join('|');
      const group = groups.get(key) || { candidates, entries: [] };
      group.entries.push(entry);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const assets: CountryAsset[] = [];
      // Retain boundaries for one route group, rather than the entire travel history.
      for (let i = 0; i < group.candidates.length; i += 3) assets.push(...await Promise.all(group.candidates.slice(i, i + 3).map(entry => asset(entry, base))));
      const partitioner = new CountryPartitioner(assets);
      for (const entry of group.entries) {
        const result = partitioner.partition(entry.segment, entry.geometry);
        results[entry.key] = result;
        if (db && entry.allowCache) {
          try { db.transaction('results', 'readwrite').objectStore('results').put(result, entry.hash); } catch { /* Optional local cache. */ }
        }
      }
    }
    self.postMessage({ data: { index, results } });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally { db?.close(); }
};
