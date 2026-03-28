import { TRANSPORT_MODES, type Trip } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';
import { getSegmentDistanceSummary } from '../utils/distance';
import { routingManager } from '../routing/RoutingService';

interface SegmentInfoProps {
  segmentId: string;
  trip: Trip;
  onGoBack: () => void;
  onUpdateTrip: (newTrip: Trip) => void;
}

export function SegmentInfo({ segmentId, trip, onGoBack, onUpdateTrip }: SegmentInfoProps) {
  const seg = trip.segments.find(s => s.id === segmentId);
  if (!seg) return null;

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack}>
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Segment Info</h2>
        <div style={{ width: 28 }}></div>
      </div>
      <div className="content">
        <div className="form-group">
          <label className="form-label">ID (Read-only)</label>
          <input type="text" readOnly value={seg.id} className="form-input" />
        </div>
        <div className="form-group">
           <label className="form-label">Name</label>
           <input 
             key={`segname-${seg.name || ''}`}
             type="text" 
             defaultValue={seg.name || ''} 
             className="form-input" 
             onBlur={(e) => {
               if (e.target.value !== (seg?.name || '')) {
                 const newSegments = trip.segments.map(s => 
                   s.id === segmentId ? { ...s, name: e.target.value } : s
                 );
                 onUpdateTrip({ ...trip, segments: newSegments });
               }
             }}
           />
        </div>
        <div className="form-group">
           <label className="form-label">Detailed Mode</label>
           <div className="mode-selector">
              {TRANSPORT_MODES.map(m => {
                const theme = ModeThemes[m];
                const isSelected = seg.detailedMode === m;
                return (
                  <button
                    key={m}
                    title={m}
                    className="mode-button"
                    style={{
                      border: isSelected ? `2px solid ${theme?.color || '#007bff'}` : '1px solid #ddd',
                      background: isSelected ? `${theme?.color || '#007bff'}22` : 'white',
                    }}
                    onClick={() => {
                      if (!isSelected) {
                        const newSegments = trip.segments.map(s =>
                          s.id === segmentId ? { ...s, detailedMode: m } : s
                        );
                        onUpdateTrip({ ...trip, segments: newSegments });
                      }
                    }}
                  >
                    {getModeIcon(m, 24)}
                  </button>
                );
              })}
           </div>
        </div>
        <div className="form-group">
           <label className="form-label">Routing Profile</label>
           <select 
             className="form-input" 
             value={`${seg.routingService}|${seg.routingProfile}`}
             onChange={(e) => {
               const [service, profile] = e.target.value.split('|');
               const newSegments = trip.segments.map(s => 
                 s.id === segmentId ? { ...s, routingService: service, routingProfile: profile } : s
               );
               onUpdateTrip({ ...trip, segments: newSegments });
             }}
           >
             {seg.detailedMode && routingManager.getServices().flatMap(svc => 
                 svc.getRoutingProfiles(seg.detailedMode).map(profile => (
                   <option key={`${svc.name}|${profile}`} value={`${svc.name}|${profile}`}>
                     {svc.name.replace(' Router', '')} [{profile}]
                   </option>
                 ))
             )}
           </select>
        </div>
        <div className="form-group">
           <label className="form-label">Source (Read-only)</label>
           <input type="text" readOnly value={seg.source} className="form-input" />
        </div>

        <div className="trip-summary" style={{ marginTop: 16 }}>
           <h3 className="trip-summary-title">
             <MaterialIcon name="analytics" size={18} /> Segment Summary
           </h3>
           <div className="trip-summary-total">
             <strong>Total Distance:</strong> {getSegmentDistanceSummary(seg).totalDistance.toFixed(1)} km
           </div>
           {getSegmentDistanceSummary(seg).hasElevation && (
             <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: '0.9rem', color: '#666' }}>
               <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                 <MaterialIcon name="trending_up" size={16} /> +{Math.round(getSegmentDistanceSummary(seg).elevationUp)} m
               </span>
               <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                 <MaterialIcon name="trending_down" size={16} /> -{Math.round(getSegmentDistanceSummary(seg).elevationDown)} m
               </span>
             </div>
           )}
        </div>
      </div>
    </>
  );
}