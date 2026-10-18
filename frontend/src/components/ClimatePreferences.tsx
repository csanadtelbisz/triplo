import { useState } from 'react';
import type { NamedClimateProfile } from '../../../shared/types';
import { saveClimateProfiles } from '../climate/profiles';
import { useClimateSettings } from '../climate/useClimateSettings';
import { syncPreferencesToCloud } from '../utils/preferencesSync';
import { MaterialIcon } from './MaterialIcon';
import { ClimateAttribution, ClimateProfileDialog } from './ClimateProfileEditor';

export function ClimatePreferences() {
  const { profiles } = useClimateSettings();
  const [editing, setEditing] = useState<NamedClimateProfile | null>(null);
  const save = (next: NamedClimateProfile[]) => {
    saveClimateProfiles(next);
    window.dispatchEvent(new Event('preferences-updated'));
    void syncPreferencesToCloud();
  };
  return <>
    <h3 className="status-panel-section-title">Climate profiles</h3>
    <div className="climate-preferences">
      <div className="climate-profile-list">
        {profiles.map(p => <div className="climate-profile-row" key={p.id}>
          <MaterialIcon name="eco" size={18} /><span>{p.name}</span>
          <button className="iconButton" aria-label={`Edit ${p.name}`} title={`Edit ${p.name}`} onClick={() => setEditing(p)}><MaterialIcon name="edit" size={18} /></button>
          <button className="iconButton" aria-label={`Delete ${p.name}`} title={`Delete ${p.name}`} onClick={() => save(profiles.filter(item => item.id !== p.id))}><MaterialIcon name="delete" size={18} /></button>
        </div>)}
        <button className="dialog-btn dialog-btn-secondary" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', profile: { mode: 'car' } })}>Add climate profile</button>
      </div>
      <ClimateAttribution />
    </div>
    {editing && <ClimateProfileDialog key={editing.id} initial={editing.profile} initialName={editing.name} named profiles={profiles.filter(p => p.id !== editing.id)} onClose={() => setEditing(null)} onSave={(profile, name) => {
      const next = { ...editing, profile, name };
      save(profiles.some(p => p.id === editing.id) ? profiles.map(p => p.id === editing.id ? next : p) : [...profiles, next]);
      setEditing(null);
    }} />}
  </>;
}

export function DefaultClimateProfileSelect({ value, onChange, label }: { value?: string; onChange: (id?: string) => void; label: string }) {
  const { profiles } = useClimateSettings();
  return <select className="climate-default-select" aria-label={label} title={label} value={profiles.some(p => p.id === value) ? value : ''} onChange={e => onChange(e.target.value || undefined)}>
    <option value="">Climate profile: built-in default</option>
    {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
  </select>;
}
