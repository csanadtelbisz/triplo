import { useId, useState } from 'react';
import type { ClimateProfile, Segment, Trip } from '../../../shared/types';
import { resolveClimateProfile, segmentClimate } from '../climate/profiles';
import { useClimateSettings } from '../climate/useClimateSettings';
import { ClimateAttribution, ClimateProfileEditor } from './ClimateProfileEditor';
import { countryDistances } from '../countries/parts';
import { defaultData } from '../../../climate/src/generated/data';
import { MaterialIcon } from './MaterialIcon';
import { climateCountryCodes } from '../climate/countryCodes';
import { segmentKey } from '../countries/types';
import type { CountryData } from '../countries/types';

const countryCodes = Object.fromEntries(Object.entries(climateCountryCodes).map(([alpha2, alpha3]) => [alpha3, alpha2]));
const gridLabel = (code: string) => countryCodes[code] || (code.startsWith('_')
  ? code.slice(1).toLowerCase().replaceAll('_', ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase()) : code);

function ClimateInfo({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <>
    <button type="button" className="climate-info-button" aria-label={label} title={text}
      aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>
      <MaterialIcon name="info_outline" size={14} aria-hidden="true" />
    </button>
    <span id={id} hidden={!expanded} className="climate-info-text" role="note">{text}</span>
  </>;
}

export function SegmentClimateCard({ trip, segment, isReadOnly, onUpdateTrip, countryData }: { trip: Trip; segment: Segment; isReadOnly?: boolean; onUpdateTrip: (trip: Trip) => void; countryData?: CountryData }) {
  const settings = useClimateSettings();
  const id = useId();
  const inherited = resolveClimateProfile(trip, segment, settings, false);
  const { result, error } = segmentClimate(trip, segment, settings, countryData?.results[segmentKey(trip.id, segment.id)]?.distanceKmByCountry);
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
    <div className="climate-result"><strong>{result ? `${result.co2eKg.toFixed(1)} kg CO₂e` : 'Unavailable'}</strong></div>
    <label className="climate-radio"><input type="radio" name={id} checked={!segment.climateProfile} disabled={isReadOnly} onChange={() => update()} />Use transport mode default: {inherited.name}</label>
    <label className="climate-radio"><input type="radio" name={id} checked={!!segment.climateProfile} disabled={isReadOnly} onChange={() => update(structuredClone(inherited.profile))} />Custom</label>
    <ClimateProfileEditor value={segment.climateProfile || inherited.profile} onChange={update} disabled={isReadOnly || !segment.climateProfile}
      excludeSegment={segmentKey(trip.id, segment.id)}
      distanceKm={segment.distanceStats?.totalDistance ?? Object.values(countryDistances(segment)).reduce((sum, km) => sum + km, 0)}
      flightGeometry={segment.source === 'gpx' ? 'exact' : 'great_circle'} />
    {error && <p role="alert">Climate impact could not be calculated: {error}</p>}
    {result && <details className="climate-details"><summary>Calculation details</summary>
      <p>Direct: {result.directKg.toFixed(2)} kg CO₂e <ClimateInfo label="About direct emissions" text="Emissions from operating the vehicle, including fuel combustion. Flights also include radiative forcing." /></p>
      <p>Upstream: {result.upstreamKg.toFixed(2)} kg CO₂e <ClimateInfo label="About upstream emissions" text="Emissions from producing and distributing fuel, and generating and supplying electricity." /></p>
      {result.factorSets.defra && <p>DEFRA factors: {result.factorSets.defra.yearUsed}</p>}
      {result.factorSets.grid && <div className="climate-electricity-details">
        <p>Electricity ({result.factorSets.grid.source})</p>
        <table className="climate-electricity-table" aria-label="Electricity emission factors">
          <thead><tr><th>Country</th><th>Share</th><th>Year</th><th>g CO₂e/kWh</th></tr></thead>
          <tbody>{result.factorSets.grid.countries.map((factor, i) => <tr key={`${factor.country}-${i}`}>
            <td><span title={factor.country}>{gridLabel(factor.country)}</span>{factor.sourceRegion !== factor.country && <small>{gridLabel(factor.sourceRegion)} average</small>}</td>
            <td>{(factor.share * 100).toFixed(1)}%</td><td>{factor.yearUsed}</td><td>{factor.intensityGCo2ePerKwh.toFixed(2)}</td>
          </tr>)}</tbody>
        </table>
        <p>Weighted electricity factor: {result.factorSets.grid.intensityGCo2ePerKwh.toFixed(2)} g CO₂e/kWh.</p>
        <p>Shares follow route distance. Factors include electricity generation lifecycle emissions; transmission and distribution losses are added separately.</p>
      </div>}
      {result.factorSets.railEnergy && <p>Rail energy benchmark: {result.factorSets.railEnergy.yearUsed} ({result.factorSets.railEnergy.source})</p>}
      {result.factorSets.aircraft && <p>Aircraft table: {/^\d{4}$/.test(result.factorSets.aircraft.tableVersion) ? result.factorSets.aircraft.tableVersion : defaultData.flight.year}</p>}
      {result.assumptions.map((a, i) => <p key={`a${i}`}>{a}</p>)}
      {result.warnings.map((w, i) => <p key={`w${i}`}>{w.message}</p>)}
    </details>}
    <ClimateAttribution />
  </div>;
}
