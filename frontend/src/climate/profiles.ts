import { calculate } from '../../../climate/src/calculate';
import { defaultBusType } from '../../../climate/src/bus';
import { defaultRailType, resolveRailTraction } from '../../../climate/src/rail';
import type { ClimateResult, CountryShares, TravelInput } from '../../../climate/src/types';
import { climateDataRevision } from '../../../climate/src/generated/data';
import type { ClimateProfile, ClimateProfileChoice, NamedClimateProfile, Segment, SegmentClimateImpact, Trip } from '../../../shared/types';
import { getBuiltInModeOverrides } from '../utils/builtInModesPreferences';
import { getCustomOtherModes } from '../utils/customModesPreferences';
import { countryDistances } from '../countries/parts';
import { modeKey } from '../countries/analytics';
import { climateCountryCodes } from './countryCodes';
import { copyEffectiveGeometryCache } from '../utils/effectiveGeometry';
import { noEmissionResult } from './cache';
import { segmentKey } from '../countries/types';
import type { CountryData } from '../countries/types';

// Bump when calculator rules, adapter rules, or country-code mappings change.
const CLIMATE_CALCULATION_VERSION = 10;
const climateRevision = `${CLIMATE_CALCULATION_VERSION}:${climateDataRevision}`;
const computed = new WeakMap<Segment, SegmentClimateImpact>();

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    // Summing saved country-part distances can differ from the original total
    // by a few floating-point bits. Ignore that noise in cache keys only.
    if (typeof item === 'number' && Number.isFinite(item)) return Number(item.toPrecision(12));
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : item;
  });
}

export function getClimateProfiles(): NamedClimateProfile[] {
  try {
    const stored = JSON.parse(localStorage.getItem('climateProfiles') || '[]');
    return Array.isArray(stored) ? stored.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.profile) : [];
  } catch { return []; }
}
export function saveClimateProfiles(profiles: NamedClimateProfile[]) {
  localStorage.setItem('climateProfiles', JSON.stringify(profiles));
}
export function getClimateSettings() {
  return { profiles: getClimateProfiles(), builtIn: getBuiltInModeOverrides(), custom: getCustomOtherModes() };
}
export type ClimateSettings = ReturnType<typeof getClimateSettings>;

export const builtInClimateProfiles: NamedClimateProfile[] = [
  { id: 'builtin:car', name: 'Car [built-in]', profile: { mode: 'car' } },
  { id: 'builtin:bus', name: 'Bus [built-in]', profile: { mode: 'bus' } },
  { id: 'builtin:rail', name: 'Rail [built-in]', profile: { mode: 'rail', traction: 'electric' } },
  { id: 'builtin:flight', name: 'Flight [built-in]', profile: { mode: 'flight' } },
  { id: 'builtin:ferry', name: 'Ferry [built-in]', profile: { mode: 'ferry' } },
  { id: 'builtin:none', name: 'No emission', profile: { mode: 'none' } },
];
export function defaultClimateProfileId(mode: string): string {
  const algorithm = mode === 'taxi' ? 'car' : mode === 'subway' ? 'rail' : mode;
  const id = `builtin:${algorithm}`;
  return builtInClimateProfiles.some(p => p.id === id) ? id : 'builtin:none';
}
export function builtInClimateProfile(mode: string): ClimateProfile {
  return { ...builtInClimateProfiles.find(p => p.id === defaultClimateProfileId(mode))!.profile };
}
export function climateModeLabel(segment: Segment, settings: ClimateSettings): string {
  return segment.transportMode === 'other'
    ? settings.custom.find(m => m.icon === segment.customIcon)?.name || segment.customIcon?.replaceAll('_', ' ') || 'Other'
    : settings.builtIn[segment.transportMode]?.name || segment.transportMode.charAt(0).toUpperCase() + segment.transportMode.slice(1);
}
export function namedProfileChoice(profile: NamedClimateProfile): ClimateProfileChoice {
  return { profileId: profile.id, name: profile.name, profile: structuredClone(profile.profile) };
}
export function resolveClimateProfile(trip: Trip, segment: Segment, settings: ClimateSettings, includeSegment = true): { profile: ClimateProfile; name: string } {
  if (includeSegment && segment.climateProfile) return { profile: segment.climateProfile, name: 'Custom' };
  const modeName = climateModeLabel(segment, settings);
  const tripChoice = trip.climateProfiles?.[modeKey(segment)];
  if (tripChoice) {
    if ('custom' in tripChoice) return { profile: tripChoice.custom, name: `${modeName} (trip default)` };
    const saved = [...builtInClimateProfiles, ...settings.profiles].find(p => p.id === tripChoice.profileId);
    return { profile: saved?.profile || tripChoice.profile, name: saved?.name || tripChoice.name };
  }
  const id = segment.transportMode === 'other' ? settings.custom.find(m => m.icon === segment.customIcon)?.climateProfileId : settings.builtIn[segment.transportMode]?.climateProfileId;
  const available = [...builtInClimateProfiles, ...settings.profiles];
  const preferred = available.find(p => p.id === id) || available.find(p => p.id === defaultClimateProfileId(segment.transportMode))!;
  return { profile: preferred.profile, name: preferred.name };
}

/** Unknown country pieces retain their weight and use the calculator's world fallback. */
export function routeCountryShares(segment: Segment, distances = countryDistances(segment)): CountryShares | undefined {
  const shares: CountryShares = {};
  for (const [code, distance] of Object.entries(distances)) {
    if (distance > 0) {
      const iso3 = climateCountryCodes[code] || '_WORLD';
      shares[iso3] = (shares[iso3] || 0) + distance;
    }
  }
  const total = Object.values(shares).reduce((sum, km) => sum + km, 0);
  return total > 0 ? Object.fromEntries(Object.entries(shares).map(([code, km]) => [code, km / total])) : undefined;
}

export interface SegmentClimate {
  result?: ClimateResult;
  error?: string;
}
function climateInput(trip: Trip, segment: Segment, settings: ClimateSettings, distances = countryDistances(segment)): { input: TravelInput; undated?: boolean } {
  if (segment.routingProfile === 'teleport') return { input: { mode: 'none' } };
  const profile = resolveClimateProfile(trip, segment, settings).profile;
  const km = segment.distanceStats?.totalDistance ?? Object.values(distances).reduce((a, b) => a + b, 0);
  if (profile.mode === 'none' || km === 0) return { input: { mode: 'none' } };
  const date = segment.waypoints.find(w => w.date)?.date || trip.startDate || trip.endDate || trip.createdAt;
  const dated = date?.slice(0, 10) || `${new Date().getFullYear()}-01-01`;
  const shares = routeCountryShares(segment, distances);
  let options = profile;
  // Keep the resolved bus type in the cache key even when distance rounding crosses 10 km.
  if (options.mode === 'bus') options = { ...options, busType: options.busType ?? defaultBusType(km) };
  if (options.mode === 'car') options = { ...options, gridShares: shares };
  if (options.mode === 'rail') {
    // Resolve before cache-key rounding, including routes immediately below 30 km.
    const railType = options.railType ?? defaultRailType(km);
    const traction = !options.railType && railType !== 'inter_city' ? 'electric' : resolveRailTraction(options.traction);
    options = { ...options, railType, traction, countryShares: shares };
  }
  if (options.mode === 'flight') options = { ...options, geometry: options.geometry || (segment.source === 'gpx' ? 'exact' : 'great_circle') };
  return { input: { ...options, date: dated, distanceKm: km }, undated: !date };
}

function segmentClimateCache(trip: Trip, segment: Segment, settings: ClimateSettings, distances?: Record<string, number>): SegmentClimateImpact {
  const { input, undated } = climateInput(trip, segment, settings, distances);
  const inputKey = input.mode === 'none' ? 'none' : canonical({ revision: climateRevision, input, undated });
  // Only trust results calculated in this session, never legacy saved entries.
  const cached = computed.get(segment);
  if (cached?.inputKey === inputKey) return cached;
  let next: SegmentClimateImpact;
  try {
    const result = input.mode === 'none' ? noEmissionResult() : calculate(input);
    if (undated && input.mode !== 'none') result.assumptions.unshift(`No trip date: ${input.date.slice(0, 4)} factors selected`);
    next = { inputKey, result };
  } catch (error) {
    next = { inputKey, error: error instanceof Error ? error.message : String(error) };
  }
  computed.set(segment, next);
  return next;
}

export function segmentClimate(trip: Trip, segment: Segment, settings: ClimateSettings, distances?: Record<string, number>): SegmentClimate {
  return segmentClimateCache(trip, segment, settings, distances);
}

/** Refresh transient results; preserve identities when current inputs are unchanged. */
export function withClimateCache(trip: Trip, settings: ClimateSettings = getClimateSettings()): Trip {
  if (trip.metadata?.isSharedTripReference) return trip;
  let changed = false;
  const segments = trip.segments.map(segment => {
    const climateImpact = segmentClimateCache(trip, segment, settings);
    if (climateImpact === segment.climateImpact) return segment;
    changed = true;
    const next = { ...segment, climateImpact };
    computed.set(next, climateImpact);
    copyEffectiveGeometryCache(segment, next);
    return next;
  });
  return changed ? { ...trip, segments } : trip;
}

export function tripClimate(trip: Trip, settings: ClimateSettings, data?: CountryData) {
  const byMode: Record<string, number> = {};
  const unavailableByMode: Record<string, number> = {};
  let totalKg = 0, unavailable = 0;
  for (const segment of trip.segments) {
    const { result } = segmentClimate(trip, segment, settings, data?.results[segmentKey(trip.id, segment.id)]?.distanceKmByCountry);
    if (!result) {
      unavailable++;
      const key = modeKey(segment);
      unavailableByMode[key] = (unavailableByMode[key] || 0) + 1;
      continue;
    }
    totalKg += result.co2eKg;
    const key = modeKey(segment);
    byMode[key] = (byMode[key] || 0) + result.co2eKg;
  }
  return { totalKg, byMode, unavailable, unavailableByMode };
}
