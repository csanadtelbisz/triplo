import { useId, useState } from 'react';
import type { ClimateProfile, NamedClimateProfile } from '../../../shared/types';
import type { SeatClass } from '../../../climate/src/types';
import { defaultData } from '../../../climate/src/generated/data';
import { CAR_SIZE_EXAMPLES } from '../../../climate/src/examples';
import { Dialog } from './Dialog';
import '../styles/Climate.css';

const text = (value: string) => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const classes: SeatClass[] = ['economy', 'premium_economy', 'business', 'first'];
export function ClimateProfileEditor({ value, onChange, profiles, name, onNameChange, disabled = false }: {
  value: ClimateProfile; onChange: (profile: ClimateProfile) => void; profiles: NamedClimateProfile[];
  name?: string; onNameChange?: (name: string) => void; disabled?: boolean;
}) {
  const [copyId, setCopyId] = useState('');
  const id = useId();
  const patch = (options: object) => {
    const next = { ...value, ...options } as ClimateProfile;
    if (next.mode === 'car' && !['petrol', 'diesel', 'hybrid', 'lpg'].includes(next.fuelType || '')) delete next.exactFuelLPer100Km;
    if (next.mode === 'rail' && next.railType && next.railType !== 'inter_city') next.traction = 'electric';
    onChange(next);
  };
  const select = (label: string, key: string, current: string, values: string[], labels?: string[]) => <label>{label}
    <select aria-label={label} value={current} onChange={e => patch({ [key]: e.target.value || undefined })}>
      {values.map((v, i) => <option key={v} value={v}>{labels?.[i] || text(v)}</option>)}
    </select>
  </label>;
  const number = (label: string, key: string, current: number | undefined, min: number, max?: number, scale = 1, placeholder = 'Automatic') => <label>{label}
    <input type="number" min={min} max={max} step="any" placeholder={placeholder} value={current === undefined ? '' : current * scale} onChange={e => {
      if (e.target.validity.valid) patch({ [key]: e.target.value === '' ? undefined : Number(e.target.value) / scale });
    }} />
  </label>;
  return <fieldset className="climate-editor" disabled={disabled}>
    {onNameChange && <label>Name<input required value={name || ''} onChange={e => onNameChange(e.target.value)} /></label>}
    <div className="climate-copy-row">
      <label>Copy from:<select aria-label="Copy from:" value={copyId} onChange={e => setCopyId(e.target.value)}><option value="">Select climate profile…</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button type="button" className="dialog-btn dialog-btn-secondary" disabled={!profiles.some(p => p.id === copyId)} onClick={() => {
        const source = profiles.find(p => p.id === copyId); if (source) onChange(structuredClone(source.profile));
      }}>Copy</button>
    </div>
    <label>Base algorithm<select aria-label="Base algorithm" value={value.mode} onChange={e => onChange({ mode: e.target.value } as ClimateProfile)}>
      <option value="none">No emissions</option><option value="car">Car / taxi</option><option value="bus">Bus</option><option value="rail">Rail / subway</option><option value="flight">Flight</option><option value="ferry">Ferry</option>
    </select></label>
    {value.mode === 'none' && <small>Zero transport emissions.</small>}
    {value.mode === 'car' && <>
      {select('Fuel type', 'fuelType', value.fuelType || 'average', ['average', 'petrol', 'diesel', 'hybrid', 'phev', 'bev', 'cng', 'lpg'], ['Average', 'Petrol', 'Diesel', 'Hybrid (petrol)', 'Plug-in hybrid', 'Electric (BEV)', 'CNG', 'LPG'])}
      {select('Car size', 'engineSize', value.engineSize || 'average', ['average', 'small', 'medium', 'large'])}
      {value.engineSize && value.engineSize !== 'average' && <small>Examples: {CAR_SIZE_EXAMPLES[value.engineSize][value.fuelType === 'bev' ? 'electric' : 'fuelBased'].join(', ')}</small>}
      {number('Occupancy (people)', 'occupancy', value.occupancy, 1, 9, 1, '1.5')}
      {['petrol', 'diesel', 'hybrid', 'lpg'].includes(value.fuelType || '') && number('Fuel consumption (L/100 km)', 'exactFuelLPer100Km', value.exactFuelLPer100Km, 0)}
    </>}
    {value.mode === 'bus' && select('Bus type', 'busType', value.busType || 'coach', ['coach', 'local'])}
    {value.mode === 'rail' && <>
      {select('Rail type', 'railType', value.railType || 'inter_city', ['high_speed', 'inter_city', 'light_rail', 'subway'])}
      {(!value.railType || value.railType === 'inter_city') && select('Traction', 'traction', value.traction || 'unknown', ['unknown', 'electric', 'diesel'])}
      {value.traction === 'diesel' && <small>Diesel-only factors are unavailable; the calculator uses the UK national rail mix.</small>}
    </>}
    {value.mode === 'ferry' && <label className="climate-check"><input type="checkbox" checked={value.withVehicle || false} onChange={e => patch({ withVehicle: e.target.checked })} />Travelling with a car</label>}
    {value.mode === 'flight' && <>
      {select('Distance basis', 'geometry', value.geometry || '', ['', 'great_circle', 'exact'], ['Automatic (track or great circle)', 'Great circle (+8% flown distance)', 'Exact flown track'])}
      {select('Cabin class', 'cabinClass', value.cabinClass || 'average', ['average', ...classes])}
      <label>Aircraft type (ICAO)<input list={`${id}-aircraft`} placeholder="Automatic, e.g. A20N" value={value.aircraftType || ''} onChange={e => patch({ aircraftType: e.target.value.toUpperCase() || undefined })} /></label>
      <datalist id={`${id}-aircraft`}>{[...new Map(defaultData.aircraft.flatMap(a => a.icao.map(code => [code, a.model] as const))).entries()].map(([code, model]) => <option key={code} value={code}>{model}</option>)}</datalist>
      <label>Airline (ICAO)<input list={`${id}-operators`} placeholder="Automatic, e.g. RYR" value={value.operator || ''} onChange={e => patch({ operator: e.target.value.toUpperCase() || undefined })} /></label>
      <datalist id={`${id}-operators`}>{Object.entries(defaultData.operators).map(([code, operator]) => <option key={code} value={code}>{operator.name}</option>)}</datalist>
      {number('Passenger load factor (%)', 'loadFactor', value.loadFactor, 0.01, 100, 100)}
      <label className="climate-check"><input type="checkbox" checked={!!value.seats} onChange={e => patch({ seats: e.target.checked ? { economy: 180 } : undefined })} />Override seat configuration</label>
      {value.seats && classes.map(c => <label key={c}>{text(c)} seats<input type="number" min="0" step="1" value={value.seats?.[c] ?? 0} onChange={e => {
        if (e.target.validity.valid) patch({ seats: { ...value.seats, [c]: Number(e.target.value) } });
      }} /></label>)}
      {value.seats && !Object.values(value.seats).some(n => n && n > 0) && <small role="alert">Enter at least one seat; otherwise average flight factors will be used.</small>}
      <small>Seat and load overrides apply when an aircraft type is recognized. Flight estimates always include radiative forcing.</small>
    </>}
  </fieldset>;
}

export function ClimateProfileDialog({ initial, profiles, named = false, initialName = '', onSave, onClose }: {
  initial: ClimateProfile; profiles: NamedClimateProfile[]; named?: boolean; initialName?: string;
  onSave: (profile: ClimateProfile, name: string) => void; onClose: () => void;
}) {
  // The dialog mounts per editing session, so Cancel always discards the draft.
  const [profile, setProfile] = useState(() => structuredClone(initial));
  const [name, setName] = useState(initialName);
  return <Dialog isOpen title={named ? 'Climate profile' : 'Custom climate profile'} onClose={onClose} className="climate-dialog">
    <form onSubmit={e => { e.preventDefault(); if (!named || name.trim()) onSave(profile, name.trim()); }}>
      <ClimateProfileEditor value={profile} onChange={setProfile} profiles={profiles} name={name} onNameChange={named ? setName : undefined} />
      <div className="dialog-actions"><button type="button" className="dialog-btn dialog-btn-cancel" onClick={onClose}>Cancel</button><button type="submit" className="dialog-btn dialog-btn-primary" disabled={named && !name.trim()}>Save</button></div>
    </form>
  </Dialog>;
}

export function ClimateAttribution() {
  return <details className="climate-attribution"><summary>Climate data and methodology</summary>
    <p>Electricity uses the cached route country shares automatically. Estimates are well-to-wheel, per traveller, in kg CO₂e. Flights include radiative forcing. Vehicle manufacture is excluded.</p>
    <p>UK Government GHG Conversion Factors for Company Reporting 2015–2026, DESNZ and DEFRA; processed into derived tables. Contains public sector information licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noreferrer">Open Government Licence v3.0</a>.</p>
    <p>Ember (2026) and other sources – with major processing by Our World in Data. Data: Ember, Energy Institute; processed by <a href="https://ourworldindata.org/energy" target="_blank" rel="noreferrer">Our World in Data</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>); filtered to country, year and electricity intensity.</p>
  </details>;
}
