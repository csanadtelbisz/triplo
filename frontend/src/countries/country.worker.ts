import { bbox } from '@turf/turf';
import type { Trip } from '../../../shared/types';
import { GEOMETRY_VERSION, getEffectiveGeometry } from '../utils/effectiveGeometry';
import { CountryPartitioner, overlaps } from './partition';
import { COUNTRY_ALGORITHM_VERSION, segmentKey } from './types';
import type { Bounds, CountryAsset, CountryIndex, CountryResult } from './types';
import type { CountryWorkerUpdate } from './types';
import { canPersistCountryDistances, countrySummary, validCountryDistances } from './cache';
import { countryName } from './names';

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

async function cacheResults(db: IDBDatabase | null, entries: { hash: string; result: CountryResult }[]): Promise<void> {
  if (!db || !entries.length) return;
  await new Promise<void>(resolve => {
    try {
      const transaction = db.transaction('results', 'readwrite');
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
      const store = transaction.objectStore('results');
      for (const entry of entries) store.put(entry.result, entry.hash);
    } catch { resolve(); }
  });
}

async function asset(entry: CountryIndex['countries'][number], base: string): Promise<CountryAsset> {
  const url = new URL(entry.file, base);
  url.searchParams.set('v', entry.sha256);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load boundaries for ${countryName(entry)} (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (await digest(bytes) !== entry.sha256) throw new Error(`Boundary checksum mismatch for ${countryName(entry)}`);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const country: CountryAsset = await new Response(stream).json();
  return { code: country.code, territorial: country.territorial, land: country.territorial };
}

self.onmessage = async (event: MessageEvent<{ trips: Trip[]; base: string; country?: string | null }>) => {
  const db = await database();
  let timer: ReturnType<typeof setInterval> | undefined;
  let publish: ((complete: boolean) => void) | undefined;
  try {
    const { trips, base, country } = event.data;
    const response = await fetch(new URL('index.json', base), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Cannot load the country catalog (${response.status})`);
    const index: CountryIndex = await response.json();
    const results: Record<string, CountryResult> = {};
    const distances: Record<string, Record<string, number>> = {};
    let pendingResults: typeof results = {}, pendingDistances: typeof distances = {};
    let currentTrip: CountryWorkerUpdate['currentTrip'];
    publish = complete => {
      const update: CountryWorkerUpdate = {
        complete, data: { index, results: complete ? results : pendingResults },
        distances: complete ? distances : pendingDistances, currentTrip: complete ? undefined : currentTrip,
      };
      self.postMessage(update);
      pendingResults = {}; pendingDistances = {};
    };
    publish(false);
    timer = setInterval(() => publish!(false), 500);
    const entries = [];
    for (const trip of trips) for (const segment of trip.segments) {
      const geometry = getEffectiveGeometry(segment);
      const hash = await textHash([index.version, COUNTRY_ALGORITHM_VERSION, GEOMETRY_VERSION, segment.transportMode, segment.routingProfile, geometry, segment.waypoints.map(w => [w.id, w.coordinates])]);
      const allowCache = canPersistCountryDistances(trip);
      let result = allowCache ? await cached(db, hash) : undefined;
      const saved = validCountryDistances(segment.countryDistances) ? segment.countryDistances : undefined;
      const needsGeometry = !!country && !!saved?.[country];
      if (!result && saved) result = countrySummary(saved);
      const needsCalculation = !result || (result.geometryReady === false && needsGeometry);
      const entry = { key: segmentKey(trip.id, segment.id), hash, segment, geometry, allowCache, needsCalculation, trip };
      entries.push(entry);
      if (result) {
        results[entry.key] = pendingResults[entry.key] = result;
        if (allowCache) distances[entry.key] = pendingDistances[entry.key] = result.distanceKmByCountry;
      }
    }
    const groups = new Map<string, { candidates: CountryIndex['countries']; entries: typeof entries }>();
    for (const entry of entries) {
      if (!entry.needsCalculation) continue;
      const bounds = entry.segment.transportMode === 'flight' || entry.segment.routingProfile === 'teleport' ? []
        : entry.geometry.coordinates.map(coordinates => bbox({ type: 'LineString', coordinates }) as Bounds);
      const candidates = index.countries.filter(country => country.bounds.some(b => bounds.some(route => overlaps(b, route))));
      const key = JSON.stringify([entry.trip.id, candidates.map(c => c.code)]);
      const group = groups.get(key) || { candidates, entries: [] };
      group.entries.push(entry);
      groups.set(key, group);
    }
    let loadedCountries: string | undefined;
    let partitioner: CountryPartitioner | undefined;
    for (const group of groups.values()) {
      currentTrip = { id: group.entries[0].trip.id, name: group.entries[0].trip.name };
      const countriesKey = group.candidates.map(country => country.code).join('|');
      if (loadedCountries !== countriesKey) {
        const assets: CountryAsset[] = [];
        // Retain boundaries for one route group, rather than the entire travel history.
        for (let i = 0; i < group.candidates.length; i += 3) assets.push(...await Promise.all(group.candidates.slice(i, i + 3).map(entry => asset(entry, base))));
        partitioner = new CountryPartitioner(assets);
        loadedCountries = countriesKey;
      }
      let sliceStarted = performance.now();
      const toCache: { hash: string; result: CountryResult }[] = [];
      for (const entry of group.entries) {
        currentTrip = { id: entry.trip.id, name: entry.trip.name };
        const steps = partitioner!.partitionSteps(entry.segment, entry.geometry);
        let step = steps.next();
        while (!step.done) {
          await new Promise(resolve => setTimeout(resolve, 0));
          step = steps.next();
          sliceStarted = performance.now();
        }
        const result = step.value;
        results[entry.key] = pendingResults[entry.key] = result;
        if (entry.allowCache) {
          toCache.push({ hash: entry.hash, result });
          distances[entry.key] = pendingDistances[entry.key] = result.distanceKmByCountry;
        }
        if (performance.now() - sliceStarted >= 16) {
          await new Promise(resolve => setTimeout(resolve, 0));
          sliceStarted = performance.now();
        }
      }
      await cacheResults(db, toCache);
    }
    publish(true);
  } catch (error) {
    publish?.(false);
    self.postMessage({ complete: true, error: error instanceof Error ? error.message : String(error) } satisfies CountryWorkerUpdate);
  } finally { clearInterval(timer); db?.close(); }
};
