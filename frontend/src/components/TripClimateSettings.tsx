import { useState } from 'react';
import type { ClimateProfile, ClimateProfileChoice, Segment, Trip } from '../../../shared/types';
import { builtInClimateProfile, climateModeLabel, namedProfileChoice, resolveClimateProfile } from '../climate/profiles';
import { useClimateSettings } from '../climate/useClimateSettings';
import { modeKey } from '../countries/analytics';
import { ClimateProfileDialog } from './ClimateProfileEditor';
import { Dialog } from './Dialog';
import { MaterialIcon, getModeIcon } from './MaterialIcon';

export function TripClimateSettings({ trip, onSave, onClose }: { trip: Trip; onSave: (profiles: Trip['climateProfiles']) => void; onClose: () => void }) {
  const settings = useClimateSettings();
  const [profiles, setProfiles] = useState<Record<string, ClimateProfileChoice>>(() => structuredClone(trip.climateProfiles || {}));
  const [editing, setEditing] = useState<{ key: string; profile: ClimateProfile } | null>(null);
  const modes = new Map<string, Segment>();
  for (const segment of trip.segments) if (!modes.has(modeKey(segment))) modes.set(modeKey(segment), segment);
  const setChoice = (key: string, choice?: ClimateProfileChoice) => setProfiles(current => {
    const next = { ...current }; if (choice) next[key] = choice; else delete next[key]; return next;
  });
  return <>
    <Dialog isOpen title="Trip climate profile defaults" onClose={onClose} className="climate-dialog" actions={<>
      <button className="dialog-btn dialog-btn-cancel" onClick={onClose}>Cancel</button>
      <button className="dialog-btn dialog-btn-primary" onClick={() => onSave(Object.keys(profiles).length ? profiles : undefined)}>Save</button>
    </>}>
      <table className="climate-trip-table"><tbody>{[...modes].map(([key, segment]) => {
        const choice = profiles[key];
        const selection = choice ? 'custom' in choice ? 'custom' : choice.profileId : '';
        const modeName = climateModeLabel(segment, settings).replace(/^./, c => c.toUpperCase());
        return <tr key={key}>
          <td>{segment.transportMode === 'other' && segment.customIcon ? <MaterialIcon name={segment.customIcon} size={20} /> : getModeIcon(segment.transportMode, 20)}</td>
          <td><label htmlFor={`climate-mode-${key}`}>{modeName}</label></td>
          <td>
            <select id={`climate-mode-${key}`} className="climate-default-select" value={selection} onChange={e => {
              const selected = e.target.value;
              if (!selected) setChoice(key);
              else if (selected === 'custom') {
                const profile = segment.transportMode === 'other'
                  ? resolveClimateProfile({ ...trip, climateProfiles: profiles }, segment, settings, false).profile
                  : builtInClimateProfile(segment.transportMode);
                setEditing({ key, profile });
              } else {
                const named = settings.profiles.find(p => p.id === selected);
                if (named) setChoice(key, namedProfileChoice(named));
              }
            }}>
              <option value="">Default ({resolveClimateProfile({ ...trip, climateProfiles: undefined }, segment, settings, false).name})</option>
              {choice && 'profileId' in choice && !settings.profiles.some(p => p.id === choice.profileId) && <option value={choice.profileId}>{choice.name} (saved)</option>}
              {settings.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="custom">Custom</option>
            </select>
          </td>
          <td className="climate-trip-edit">{choice && 'custom' in choice && <button className="iconButton" aria-label={`Edit ${climateModeLabel(segment, settings)} climate profile`} title={`Edit ${climateModeLabel(segment, settings)} climate profile`} onClick={() => setEditing({ key, profile: choice.custom })}><MaterialIcon name="edit" size={20} /></button>}
          </td>
        </tr>;
      })}</tbody></table>
      {modes.size === 0 && <p>Add a segment to set trip climate profile defaults.</p>}
    </Dialog>
    {editing && <ClimateProfileDialog key={editing.key} initial={editing.profile} onClose={() => setEditing(null)} onSave={profile => {
      setChoice(editing.key, { custom: profile }); setEditing(null);
    }} />}
  </>;
}
