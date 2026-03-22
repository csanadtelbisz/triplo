import type { Trip } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';

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
              {(['walk', 'hike', 'run', 'car', 'flight', 'train', 'light_rail', 'tram', 'ferry', 'waterway'] as const).map(m => {
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
           <label className="form-label">Routing Mode (Read-only)</label>
           <input type="text" readOnly value={seg.routingMode} className="form-input" />
        </div>
        <div className="form-group">
           <label className="form-label">Source (Read-only)</label>
           <input type="text" readOnly value={seg.source} className="form-input" />
        </div>
        {seg.routerService && (
          <div className="form-group">
             <label className="form-label">Router Service (Read-only)</label>
             <input type="text" readOnly value={seg.routerService} className="form-input" />
          </div>
        )}
      </div>
    </>
  );
}