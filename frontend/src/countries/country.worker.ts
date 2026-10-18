import { bbox } from '@turf/turf';
import type { CountryPart, Trip } from '../../../shared/types';
import { GEOMETRY_VERSION, splitDateline } from '../utils/effectiveGeometry';
import { CountryPartitioner, overlaps } from './partition';
import { BORDER_EXCURSION_METRES, COUNTRY_ALGORITHM_VERSION, segmentKey } from './types';
import type { Bounds, CountryAsset, CountryIndex, CountryResult } from './types';
import type { CountryWorkerUpdate } from './types';
import { canPersistCountryParts } from './cache';
import { resultFromParts } from './parts';
import { getSegmentGeometry } from '../utils/segmentGeometry';
import { countryName } from './names';

const digest = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const textHash = (value: unknown) => digest(new TextEncoder().encode(JSON.stringify(value)));

try { indexedDB.deleteDatabase('TriploCountryCache'); } catch { /* Older preview data is disposable. */ }

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

self.onmessage = async (event: MessageEvent<{ trips: Trip[]; base: string }>) => {
  let timer: ReturnType<typeof setInterval> | undefined;
  let publish: ((complete: boolean) => void) | undefined;
  try {
    const { trips, base } = event.data;
    const response = await fetch(new URL('index.json', base), { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Cannot load the country catalog (${response.status})`);
    const index: CountryIndex = await response.json();
    const boundaries = index.countries.map(country => [country.code, country.sha256]).sort(([a], [b]) => a.localeCompare(b));
    const revision = await textHash([index.version, boundaries, COUNTRY_ALGORITHM_VERSION, GEOMETRY_VERSION, BORDER_EXCURSION_METRES]);
    const results: Record<string, CountryResult> = {};
    let pendingResults: typeof results = {};
    let pendingParts: Record<string, CountryPart[]> = {}, pendingRevisions: Record<string, string> = {};
    let currentTrip: CountryWorkerUpdate['currentTrip'];
    publish = complete => {
      self.postMessage({ complete, data: { index, revision, results: complete ? results : pendingResults },
        parts: pendingParts, revisions: pendingRevisions, currentTrip: complete ? undefined : currentTrip } satisfies CountryWorkerUpdate);
      pendingResults = {}; pendingParts = {}; pendingRevisions = {};
    };
    publish(false);
    timer = setInterval(() => publish!(false), 500);
    const entries = [];
    const remaining = new Map<string, number>();
    for (const trip of trips) {
      for (const segment of trip.segments) {
        const key = segmentKey(trip.id, segment.id);
        if (segment.countryParts && !segment.geometry) {
          results[key] = pendingResults[key] = resultFromParts(segment);
          if (trip.countryDataRevision === revision) continue;
        }
        entries.push({ key, segment, trip });
        remaining.set(trip.id, (remaining.get(trip.id) || 0) + 1);
      }
      if (!remaining.has(trip.id) && trip.countryDataRevision !== revision && canPersistCountryParts(trip)) pendingRevisions[trip.id] = revision;
    }
    const groups = new Map<string, { candidates: CountryIndex['countries']; entries: typeof entries }>();
    for (const entry of entries) {
      const bounds = entry.segment.transportMode === 'flight' || entry.segment.routingProfile === 'teleport' ? []
        : splitDateline(getSegmentGeometry(entry.segment)?.coordinates || entry.segment.waypoints.map(w => w.coordinates)).map(coordinates => bbox({ type: 'LineString', coordinates }) as Bounds);
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
        for (let i = 0; i < group.candidates.length; i += 3) assets.push(...await Promise.all(group.candidates.slice(i, i + 3).map(entry => asset(entry, base))));
        partitioner = new CountryPartitioner(assets);
        loadedCountries = countriesKey;
      }
      for (const entry of group.entries) {
        currentTrip = { id: entry.trip.id, name: entry.trip.name };
        const steps = partitioner!.splitSegmentSteps(entry.segment);
        let step = steps.next();
        while (!step.done) { await new Promise(resolve => setTimeout(resolve, 0)); step = steps.next(); }
        const parts = step.value;
        const split = { ...entry.segment, countryParts: parts, geometry: undefined };
        results[entry.key] = pendingResults[entry.key] = resultFromParts(split);
        if (canPersistCountryParts(entry.trip)) pendingParts[entry.key] = parts;
        remaining.set(entry.trip.id, remaining.get(entry.trip.id)! - 1);
        if (!remaining.get(entry.trip.id) && canPersistCountryParts(entry.trip)) pendingRevisions[entry.trip.id] = revision;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    publish(true);
  } catch (error) {
    console.error('Country distance calculation failed:', error);
    publish?.(false);
    self.postMessage({ complete: true, error: error instanceof Error ? error.message : String(error) } satisfies CountryWorkerUpdate);
  } finally { clearInterval(timer); }
};
