import { useState } from 'react';
import { TRANSPORT_MODES, type Trip, type Segment } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';
import { getSegmentDistanceSummary } from '../utils/distance';
import { routingManager, route } from '../routing/RoutingService';
import { ElevationProfile } from './ElevationProfile';
import { ConfirmDialog } from './Dialog';

interface SegmentInfoProps {
  segmentId: string;
  trip: Trip;
  onGoBack: () => void;
  onUpdateTrip: (newTrip: Trip) => void;
  hoveredCoordinate?: { lon: number; lat: number; ele?: number } | null;
  onHoverCoordinate?: (coord: { lon: number; lat: number; ele?: number } | null) => void;
  onZoomToSegment?: (segment: Segment) => void;
}

export function SegmentInfo({ segmentId, trip, onGoBack, onUpdateTrip, hoveredCoordinate, onHoverCoordinate, onZoomToSegment }: SegmentInfoProps) {
  const seg = trip.segments.find(s => s.id === segmentId);
  const [gpxImportData, setGpxImportData] = useState<{ updatedSeg: Segment, coords: [number, number, number][], segIndex: number, newSegments: Segment[] } | null>(null);
  
  const handleImportGPX = () => {
    if (!seg) return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.gpx';
    fileInput.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      
      const coords: [number, number, number][] = [];
      const trkpts = xmlDoc.getElementsByTagName("trkpt");
      for (let i = 0; i < trkpts.length; i++) {
        const lat = parseFloat(trkpts[i].getAttribute("lat") || "0");
        const lon = parseFloat(trkpts[i].getAttribute("lon") || "0");
        const eleTag = trkpts[i].getElementsByTagName("ele")[0];
        const ele = eleTag && eleTag.textContent ? parseFloat(eleTag.textContent) : undefined;
        if (ele !== undefined && !isNaN(ele)) {
          coords.push([lon, lat, ele]);
        } else {
          coords.push([lon, lat, 0]);
        }
      }
      
      if (coords.length === 0) {
        const rtepts = xmlDoc.getElementsByTagName("rtept");
        for (let i = 0; i < rtepts.length; i++) {
          const lat = parseFloat(rtepts[i].getAttribute("lat") || "0");
          const lon = parseFloat(rtepts[i].getAttribute("lon") || "0");
          const eleTag = rtepts[i].getElementsByTagName("ele")[0];
          const ele = eleTag && eleTag.textContent ? parseFloat(eleTag.textContent) : undefined;
          if (ele !== undefined && !isNaN(ele)) {
            coords.push([lon, lat, ele]);
          } else {
            coords.push([lon, lat, 0]);
          }
        }
      }

      if (coords.length < 2) {
        alert("Could not find valid route coordinates in GPX file.");
        return;
      }

      const newSegments = [...trip.segments];
      const segIndex = newSegments.findIndex(s => s.id === segmentId);
      const updatedSeg = { 
          ...newSegments[segIndex], 
          routingService: 'gpx', 
          routingProfile: 'Imported GPX',
          source: 'gpx' as const,
          geometry: { type: 'LineString' as const, coordinates: coords }
      };
      
      setGpxImportData({ updatedSeg, coords, segIndex, newSegments });
    };
    fileInput.click();
  };

  const handleConfirmGPXWaypoints = (adjust: boolean) => {
    if (!gpxImportData) return;
    const { updatedSeg, coords, segIndex, newSegments } = gpxImportData;

    if (adjust) {
      const firstCoord: [number, number] = [coords[0][0], coords[0][1]];
      const lastCoord: [number, number] = [coords[coords.length - 1][0], coords[coords.length - 1][1]];
      
      if (updatedSeg.waypoints.length === 1) {
        updatedSeg.waypoints[0].coordinates = firstCoord;
        updatedSeg.waypoints.push({
          id: 'wp-' + Date.now().toString(),
          coordinates: lastCoord,
          type: 'stop',
          importance: 'normal'
        });
      } else if (updatedSeg.waypoints.length > 1) {
        updatedSeg.waypoints[0].coordinates = firstCoord;
        updatedSeg.waypoints[updatedSeg.waypoints.length - 1].coordinates = lastCoord;
      }
    }

    newSegments[segIndex] = updatedSeg;
    onUpdateTrip({ ...trip, segments: newSegments });
    onZoomToSegment?.(updatedSeg);
    setGpxImportData(null);
  };

  if (!seg) return null;

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack}>
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 className="toolbar-title">Segment Info</h2>
        <div className="toolbar-actions">
          <button className="iconButton" onClick={handleImportGPX} title="Import GPX">
            <MaterialIcon name="file_upload" size={20} />
          </button>
          <button className="iconButton" onClick={() => {}} title="Export GPX (Coming Soon)">
            <MaterialIcon name="file_download" size={20} />
          </button>
        </div>
      </div>
      <div className="content">
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
                        const isGpx = newSegments[segIndex].routingService === 'gpx';
                        const updatedSeg = { 
                          ...newSegments[segIndex], 
                          transportMode: m, 
                          routingService: isGpx ? 'gpx' : defRouter.serviceName, 
                          routingProfile: isGpx ? newSegments[segIndex].routingProfile : defRouter.profile 
                        };
                        
                        if (updatedSeg.source === 'router' && !isGpx) {
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
             value={seg.routingService === 'gpx' ? 'gpx|Imported GPX' : `${seg.routingService}|${seg.routingProfile}`}
             onChange={async (e) => {
               const [service, profile] = e.target.value.split('|');
               if (service === 'gpx') {
                 handleImportGPX();
                 return;
               }
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
             <option value="gpx|Imported GPX">Imported GPX</option>
           </select>
           {routingManager.getService(seg.routingService) && !routingManager.getService(seg.routingService)!.isAvailable() && (
             <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '4px' }}>
               This routing service is currently unavailable. Routes will default to straight lines.
             </div>
           )}
        </div>

        <div className="trip-summary" style={{ marginTop: 16 }}>
           <h3 className="trip-summary-title">
             <MaterialIcon name="analytics" size={18} /> Segment Summary
           </h3>
           <div className="trip-summary-total">
             <strong>Total Distance:</strong> {(seg.distanceStats?.totalDistance || 0).toFixed(1)} km
           </div>
           {seg.distanceStats?.hasElevation && (
             <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: '0.9rem', color: '#666' }}>
               <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                 <MaterialIcon name="trending_up" size={16} /> +{Math.round(seg.distanceStats.elevationUp)} m
               </span>
               <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                 <MaterialIcon name="trending_down" size={16} /> -{Math.round(seg.distanceStats.elevationDown)} m
               </span>
             </div>
           )}
           {seg.geometry && seg.distanceStats?.hasElevation && (
             <ElevationProfile geometry={seg.geometry} hoveredCoordinate={hoveredCoordinate} onHoverCoordinate={onHoverCoordinate} />
           )}
        </div>

        <div className="form-group" style={{ marginTop: 24 }}>
          <label className="form-label">ID (Read-only)</label>
          <input type="text" readOnly value={seg.id} className="form-input" />
        </div>
        <div className="form-group">
           <label className="form-label">Source (Read-only)</label>
           <input type="text" readOnly value={seg.source} className="form-input" />
        </div>
      </div>

      <ConfirmDialog
        isOpen={gpxImportData !== null}
        title="Adjust Waypoints"
        message="Do you want to adjust the first and last waypoints of this segment to match the newly imported GPX track?"
        confirmLabel="Yes, adjust them"
        cancelLabel="No, keep them"
        onConfirm={() => handleConfirmGPXWaypoints(true)}
        onCancel={() => handleConfirmGPXWaypoints(false)}
      />
    </>
  );
}