import { TRANSPORT_MODES, type Trip } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';
import { getSegmentDistanceSummary } from '../utils/distance';
import { routingManager, route } from '../routing/RoutingService';
import { ElevationProfile } from './ElevationProfile';

interface SegmentInfoProps {
  segmentId: string;
  trip: Trip;
  onGoBack: () => void;
  onUpdateTrip: (newTrip: Trip) => void;
  hoveredCoordinate?: { lon: number; lat: number; ele?: number } | null;
  onHoverCoordinate?: (coord: { lon: number; lat: number; ele?: number } | null) => void;
}

export function SegmentInfo({ segmentId, trip, onGoBack, onUpdateTrip, hoveredCoordinate, onHoverCoordinate }: SegmentInfoProps) {
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
           <label className="form-label">Transport Mode</label>
           <div className="mode-selector">
              {TRANSPORT_MODES.map(m => {
                const theme = ModeThemes[m];
                const isSelected = seg.transportMode === m;
                return (
                  <button
                    key={m}
                    title={m}
                    className="mode-button"
                    style={{
                      border: isSelected ? `2px solid ${theme?.color || '#007bff'}` : '1px solid #ddd',
                      background: isSelected ? `${theme?.color || '#007bff'}22` : 'white',
                    }}
                    onClick={async () => {
                      if (!isSelected) {
                        const defRouter = routingManager.getDefaultRouter(m);
                        const newSegments = [...trip.segments];
                        const segIndex = newSegments.findIndex(s => s.id === segmentId);
                        const updatedSeg = { ...newSegments[segIndex], transportMode: m, routingService: defRouter.serviceName, routingProfile: defRouter.profile };
                        
                        if (updatedSeg.source === 'router') {
                          const coords = updatedSeg.waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map(wp => wp.coordinates);
                          if (coords.length >= 2) {
                            updatedSeg.geometry = await route(coords as [number, number][], updatedSeg.routingService, updatedSeg.routingProfile);
                          } else {
                            delete (updatedSeg as any).geometry;
                          }
                        }
                        
                        newSegments[segIndex] = updatedSeg;
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
             onChange={async (e) => {
               const [service, profile] = e.target.value.split('|');
               const newSegments = [...trip.segments];
               const segIndex = newSegments.findIndex(s => s.id === segmentId);
               const updatedSeg = { ...newSegments[segIndex], routingService: service, routingProfile: profile };
               if (updatedSeg.source === 'router') {
                 const coords = updatedSeg.waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map(wp => wp.coordinates);
                 if (coords.length >= 2) {
                   updatedSeg.geometry = await route(coords as [number, number][], updatedSeg.routingService, updatedSeg.routingProfile);
                 } else {
                   delete (updatedSeg as any).geometry;
                 }
               }
               newSegments[segIndex] = updatedSeg;
               onUpdateTrip({ ...trip, segments: newSegments });
             }}
           >
             {seg.transportMode && routingManager.getServices().flatMap(svc => 
                 svc.getRoutingProfiles(seg.transportMode).map(profile => (
                   <option key={`${svc.name}|${profile}`} value={`${svc.name}|${profile}`}>
                     {svc.name.replace(' Router', '')} [{profile}]
                   </option>
                 ))
             )}
           </select>
           {routingManager.getService(seg.routingService) && !routingManager.getService(seg.routingService)!.isAvailable() && (
             <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '4px' }}>
               This routing service is currently unavailable. Routes will default to straight lines.
             </div>
           )}
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
           {seg.geometry && getSegmentDistanceSummary(seg).hasElevation && (
             <ElevationProfile geometry={seg.geometry} hoveredCoordinate={hoveredCoordinate} onHoverCoordinate={onHoverCoordinate} />
           )}
        </div>
      </div>
    </>
  );
}