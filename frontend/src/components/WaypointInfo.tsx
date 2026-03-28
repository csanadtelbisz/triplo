import type { Trip } from '../../../shared/types';
import { MaterialIcon } from './MaterialIcon';
import { getPOIEmoji } from '../utils/poiUtils';

interface WaypointInfoProps {
  waypointId: string;
  trip: Trip;
  onGoBack: () => void;
  onUpdateTrip: (newTrip: Trip) => void;
}

export function WaypointInfo({ waypointId, trip, onGoBack, onUpdateTrip }: WaypointInfoProps) {
  let wp: typeof trip.segments[0]['waypoints'][0] | undefined;
  trip.segments.forEach(seg => {
    const found = seg.waypoints.find(w => w.id === waypointId);
    if (found) wp = found;
  });
  
  if (!wp) return null;

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
             className="form-input" 
           />
        </div>
        <div className="form-group">
           <label className="form-label">Description</label>
           <textarea 
             key={`wpdesc-${wp.description || ''}`}
             defaultValue={wp.description || ''} 
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
        <div className="form-group visibility-switch-row">
           <label className="form-label" style={{ marginBottom: 0 }}>Visibility</label>
           <div 
             className={`visibility-switch ${wp.importance === 'normal' ? 'normal' : 'hidden'}`}
             style={{ cursor: 'pointer' }}
             onClick={() => {
               const newImportance: 'normal' | 'hidden' = wp?.importance === 'hidden' ? 'normal' : 'hidden';
               const newSegments = trip.segments.map(s => ({
                 ...s,
                 waypoints: s.waypoints.map(w => w.id === waypointId ? { ...w, importance: newImportance } : w)
               }));
               onUpdateTrip({ ...trip, segments: newSegments });
             }}
           >
             <div className={`visibility-knob ${wp.importance === 'normal' ? 'normal' : 'hidden'}`} />
           </div>
           <span style={{ fontSize: '0.8rem', color: '#333', fontWeight: 'bold' }}>{wp.importance === 'normal' ? 'Visible' : 'Hidden'}</span>
        </div>
        <div className="form-row align-end">
           <div className="form-col">
             <label className="form-label">Latitude</label>
             <input type="number" step="any" defaultValue={wp.coordinates[1]} className="form-input" style={{ height: '36px' }} />
           </div>
           <div className="form-col">
             <label className="form-label">Longitude</label>
             <input type="number" step="any" defaultValue={wp.coordinates[0]} className="form-input" style={{ height: '36px' }} />
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