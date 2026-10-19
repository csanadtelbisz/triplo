import { useState } from 'react';
import type { NamedClimateProfile } from '../../../shared/types';
import { builtInClimateProfiles, defaultClimateProfileId, saveClimateProfiles } from '../climate/profiles';
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
  const move = (index: number, direction: number) => {
    const next = [...profiles];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    save(next);
  };
  return <>
    <h3 className="status-panel-section-title">Climate profiles</h3>
    <div className="climate-preferences">
      <ClimateAttribution />
      <table className="climate-profiles-table"><tbody>
        {profiles.map((p, index) => <tr key={p.id}>
          <td>{p.name}</td>
          <td className="climate-profile-actions"><div>
            <button className="iconButton" aria-label={`Move ${p.name} up`} title="Move up" disabled={index === 0} onClick={() => move(index, -1)}><MaterialIcon name="arrow_upward" size={16} /></button>
            <button className="iconButton" aria-label={`Move ${p.name} down`} title="Move down" disabled={index === profiles.length - 1} onClick={() => move(index, 1)}><MaterialIcon name="arrow_downward" size={16} /></button>
            <button className="iconButton climate-edit" aria-label={`Edit ${p.name}`} title={`Edit ${p.name}`} onClick={() => setEditing(p)}><MaterialIcon name="edit" size={16} /></button>
            <button className="iconButton climate-delete" aria-label={`Delete ${p.name}`} title={`Delete ${p.name}`} onClick={() => save(profiles.filter(item => item.id !== p.id))}><MaterialIcon name="delete" size={16} /></button>
          </div></td>
        </tr>)}
        <tr><td colSpan={2}><button className="climate-add-profile" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', profile: { mode: 'car' } })}><MaterialIcon name="add" size={16} aria-hidden="true" />Add climate profile</button></td></tr>
      </tbody></table>
    </div>
    {editing && <ClimateProfileDialog key={editing.id} initial={editing.profile} initialName={editing.name} named onClose={() => setEditing(null)} onSave={(profile, name) => {
      const next = { ...editing, profile, name };
      save(profiles.some(p => p.id === editing.id) ? profiles.map(p => p.id === editing.id ? next : p) : [...profiles, next]);
      setEditing(null);
    }} />}
  </>;
}

export function DefaultClimateProfileSelect({ value, onChange, label, mode }: { value?: string; onChange: (id?: string) => void; label: string; mode: string }) {
  const { profiles } = useClimateSettings();
  const available = [...builtInClimateProfiles, ...profiles];
  return <label className="transport-mode-select-row"><span>Climate profile</span>
    <select className="climate-default-select" aria-label={label} title={label} value={available.some(p => p.id === value) ? value : defaultClimateProfileId(mode)} onChange={e => onChange(e.target.value)}>
      {available.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  </label>;
}
