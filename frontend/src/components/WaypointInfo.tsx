import { useState, useEffect } from 'react';
import type { Trip } from '../../../shared/types';
import { MaterialIcon } from './MaterialIcon';
import { getPOIEmoji, SUGGESTED_WAYPOINT_ICONS } from '../utils/poiUtils';

interface WaypointInfoProps {
  isReadOnly?: boolean;
  waypointId: string;
  trip: Trip;
  onGoBack: () => void;
  onUpdateTrip: (newTrip: Trip) => void;
}

export function WaypointInfo({ isReadOnly, waypointId, trip, onGoBack, onUpdateTrip }: WaypointInfoProps) {
  let wp: typeof trip.segments[0]['waypoints'][0] | undefined;
  trip.segments.forEach(seg => {
    const found = seg.waypoints.find(w => w.id === waypointId);
    if (found) wp = found;
  });

  const [customIconInput, setCustomIconInput] = useState<string>('');

  useEffect(() => {
    const isCustomIcon = wp?.icon && !SUGGESTED_WAYPOINT_ICONS.includes(wp.icon);
    setCustomIconInput(isCustomIcon && wp?.icon ? wp.icon : '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypointId, wp?.icon]);

  if (!wp) return null;

  const displayIcons = [...SUGGESTED_WAYPOINT_ICONS];
  if (customIconInput && !SUGGESTED_WAYPOINT_ICONS.includes(customIconInput)) {
    displayIcons.push(customIconInput);
  } else if (!customIconInput && wp?.icon && !SUGGESTED_WAYPOINT_ICONS.includes(wp.icon)) {
    displayIcons.push(wp.icon);
  }

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack}>
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Waypoint Info</h2>
        <div style={{ width: 28 }}></div>
      </div>
      <div className="content">
        <div className="form-group">
          <label className="form-label">ID (Read-only)</label>
          <input type="text" readOnly value={wp.id} className="form-input" />
        </div>
        <div className="form-group">
           <label className="form-label">Name</label>
           <input 
             key={`wpname-${wp.name || ''}`}
             type="text" 
             defaultValue={wp.name || ''} 
             className="form-input" 
             disabled={isReadOnly}
             onBlur={(e) => {
               if (e.target.value !== (wp?.name || '')) {
                 const newSegments = trip.segments.map(s => ({
                   ...s,
                   waypoints: s.waypoints.map(w => w.id === waypointId ? { ...w, name: e.target.value } : w)
                 }));
                 onUpdateTrip({ ...trip, segments: newSegments });
               }
             }}
           />
        </div>
        <div className="form-group">
           <label className="form-label">Date</label>
           <input 
             key={`wpdate-${wp.date || ''}`}
             type="datetime-local" 
             defaultValue={wp.date ? wp.date.slice(0, 16) : ''} 
             disabled={isReadOnly}
             className="form-input" 
           />
        </div>
        <div className="form-group">
           <label className="form-label">Description</label>
           <textarea 
             key={`wpdesc-${wp.description || ''}`}
             defaultValue={wp.description || ''} 
             disabled={isReadOnly}
             className="form-textarea" 
             onBlur={(e) => {
               if (e.target.value !== (wp?.description || '')) {
                 const newSegments = trip.segments.map(s => ({
                   ...s,
                   waypoints: s.waypoints.map(w => w.id === waypointId ? { ...w, description: e.target.value } : w)
                 }));
                 onUpdateTrip({ ...trip, segments: newSegments });
               }
             }}
           />
        </div>
        <div className="form-group">
           <label className="form-label">Icon</label>
           <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
             {displayIcons.map((iconName, iconIndex) => (
               <div 
                 key={`${iconName}-${iconIndex}`}
                 onClick={() => {
                   if (isReadOnly) return;
                   const newSegments = trip.segments.map(s => ({
                     ...s,
                     waypoints: s.waypoints.map(w => w.id === waypointId ? { ...w, icon: wp?.icon === iconName ? undefined : iconName } : w)
                   }));
                   onUpdateTrip({ ...trip, segments: newSegments });
                 }}
                 style={{ 
                   width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                   cursor: isReadOnly ? 'default' : 'pointer', borderRadius: '4px', 
                   border: wp?.icon === iconName ? '2px solid #007bff' : '1px solid #ccc',
                   background: wp?.icon === iconName ? '#e6f2ff' : '#f9f9f9',
                   opacity: isReadOnly ? 0.7 : 1
                 }}
                 title={iconName}
               >
                 <MaterialIcon name={iconName} size={20} />
               </div>
             ))}
           </div>
           <div style={{ display: 'flex', gap: '8px' }}>
             <input 
               type="text" 
               placeholder="Custom material icon name..." 
               className="form-input" 
               disabled={isReadOnly}
               value={customIconInput}
               onChange={(e) => {
                 setCustomIconInput(e.target.value);
                 if (e.target.value === '' && !wp?.icon) return;
                 const newSegments = trip.segments.map(s => ({
                   ...s,
                   waypoints: s.waypoints.map(w => w.id === waypointId ? { ...w, icon: e.target.value || undefined } : w)
                 }));
                 onUpdateTrip({ ...trip, segments: newSegments });
               }}
               onFocus={(e) => e.target.select()}
               onKeyDown={(e) => {
                 if (e.key === 'Enter') {
                   e.currentTarget.blur();
                 }
               }}
             />
             <a 
               href="https://fonts.google.com/icons?icon.style=Rounded" 
               target="_blank" 
               rel="noreferrer"
               className="iconButton" 
               title="Search Icons" 
               style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9', color: 'inherit', textDecoration: 'none' }}
             >
               <MaterialIcon name="search" size={20} />
             </a>
             <button 
               className="iconButton" 
               disabled={isReadOnly}
               title="Clear Icon" 
               onClick={() => {
                 setCustomIconInput('');
                 if (!wp?.icon) return;
                 const newSegments = trip.segments.map(s => ({
                   ...s,
                   waypoints: s.waypoints.map(w => {
                     if (w.id === waypointId) {
                       const { icon, ...rest } = w;
                       return rest;
                     }
                     return w;
                   })
                 }));
                 onUpdateTrip({ ...trip, segments: newSegments });
               }}
               style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9' }}
             >
               <MaterialIcon name="close" size={20} />
             </button>
           </div>
        </div>
        <div className="form-row align-end">
           <div className="form-col">
             <label className="form-label">Latitude</label>
             <input type="number" step="any" defaultValue={wp.coordinates[1]} disabled={isReadOnly} className="form-input" style={{ height: '36px' }} />
           </div>
           <div className="form-col">
             <label className="form-label">Longitude</label>
             <input type="number" step="any" defaultValue={wp.coordinates[0]} disabled={isReadOnly} className="form-input" style={{ height: '36px' }} />
           </div>
           <button 
             className="iconButton" 
             title="Copy Coordinates" 
             onClick={() => navigator.clipboard.writeText(`${wp?.coordinates[1]}, ${wp?.coordinates[0]}`)}
             style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9', marginBottom: '0' }}
           >
             <MaterialIcon name="content_copy" size={20} />
           </button>
        </div>

        {wp.poi && (
          <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--color-border, #eee)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
               <MaterialIcon name="place" size={20} />
               <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-text-secondary, #666)' }}>Attached POI</h3>
            </div>
            
            <div className="form-group">
              <label className="form-label">Name</label>
              <div style={{ fontSize: '0.95rem' }}>{wp.poi.name || 'Unnamed POI'}</div>
            </div>
            
            {wp.poi.type && (
              <div className="form-group">
                <label className="form-label">Type</label>
                <div style={{ textTransform: 'capitalize', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{getPOIEmoji(wp.poi.type, wp.poi.details?.type || wp.poi.details?.extratags?.poi_subclass, wp.poi.name)}</span> <span>{wp.poi.type.replace(/_/g, ' ')}</span>
                </div>
              </div>
            )}
            
            {wp.poi.details?.address && (
               <div className="form-group">
                 <label className="form-label">Address</label>
                 <div style={{ fontSize: '0.95rem' }}>
                    {[wp.poi.details.address.road, wp.poi.details.address.house_number].filter(Boolean).join(' ')}
                    {([wp.poi.details.address.road, wp.poi.details.address.house_number].some(Boolean)) ? <br/> : null}
                    {[wp.poi.details.address.postcode, wp.poi.details.address.city || wp.poi.details.address.town || wp.poi.details.address.village].filter(Boolean).join(' ')}
                    {([wp.poi.details.address.postcode, wp.poi.details.address.city || wp.poi.details.address.town || wp.poi.details.address.village].some(Boolean)) ? <br/> : null}
                    {wp.poi.details.address.country}
                 </div>
               </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}