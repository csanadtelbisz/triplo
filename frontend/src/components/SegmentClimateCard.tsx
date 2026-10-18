import { useId } from 'react';
import type { ClimateProfile, Segment, Trip } from '../../../shared/types';
import { builtInClimateProfile, resolveClimateProfile, segmentClimate } from '../climate/profiles';
import { useClimateSettings } from '../climate/useClimateSettings';
import { ClimateAttribution, ClimateProfileEditor } from './ClimateProfileEditor';
import { MaterialIcon } from './MaterialIcon';

export function SegmentClimateCard({ trip, segment, isReadOnly, onUpdateTrip }: { trip: Trip; segment: Segment; isReadOnly?: boolean; onUpdateTrip: (trip: Trip) => void }) {
  const settings = useClimateSettings();
  const id = useId();
  const inherited = resolveClimateProfile(trip, segment, settings, false);
  const { result, error } = segmentClimate(trip, segment, settings);
  const update = (climateProfile?: ClimateProfile) => {
    if (isReadOnly) return;
    onUpdateTrip({ ...trip, segments: trip.segments.map(s => {
      if (s.id !== segment.id) return s;
      const next = { ...s, climateProfile };
      if (!climateProfile) delete next.climateProfile;
      return next;
    }) });
  };
  return <div className="trip-summary" style={{ marginTop: 16 }}>
    <h3 className="trip-summary-title"><MaterialIcon name="eco" size={18} aria-hidden="true" />Climate Impact</h3>
    <div className="climate-result"><strong>{result ? `${result.co2eKg.toFixed(1)} kg CO₂e` : 'Unavailable'}</strong><small> per traveller</small></div>
    <label className="climate-radio"><input type="radio" name={id} checked={!segment.climateProfile} disabled={isReadOnly} onChange={() => update()} />Use transport mode default: {inherited.name}</label>
    <label className="climate-radio"><input type="radio" name={id} checked={!!segment.climateProfile} disabled={isReadOnly} onChange={() => update(segment.transportMode === 'other' ? structuredClone(inherited.profile) : builtInClimateProfile(segment.transportMode))} />Custom</label>
    {segment.climateProfile && <ClimateProfileEditor value={segment.climateProfile} onChange={update} profiles={settings.profiles} disabled={isReadOnly} />}
    {error && <p role="alert">Climate impact could not be calculated: {error}</p>}
    {result && <details><summary>Calculation details</summary>
      <p>Direct: {result.directKg.toFixed(2)} kg; upstream: {result.upstreamKg.toFixed(2)} kg CO₂e.</p>
      {result.factorSets.defra && <p>DEFRA factors: {result.factorSets.defra.yearUsed}</p>}
      {result.factorSets.grid && <p>Electricity: {result.factorSets.grid.yearUsed} ({result.factorSets.grid.level})</p>}
      {result.factorSets.aircraft && <p>Aircraft table: {result.factorSets.aircraft.tableVersion}</p>}
      {result.assumptions.map((a, i) => <p key={`a${i}`}>{a}</p>)}
      {result.warnings.map((w, i) => <p key={`w${i}`}>{w.message}</p>)}
    </details>}
    <ClimateAttribution />
  </div>;
}
