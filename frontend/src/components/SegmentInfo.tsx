import { useState, useEffect } from 'react';
import { TRANSPORT_MODES, type Trip, type Segment } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';
import { exportGPX, downloadFile } from '../utils/exportUtils';
import { routingManager, route } from '../routing/RoutingService';
import { ElevationProfile } from './ElevationProfile';
import { ConfirmDialog } from './Dialog';

interface SegmentInfoProps {
  segmentId: string;
  trip: Trip;
  allTrips?: Trip[];
  onGoBack: () => void;
  onUpdateTrip: (newTrip: Trip) => void;
  hoveredCoordinate?: { lon: number; lat: number; ele?: number } | null;
  onHoverCoordinate?: (coord: { lon: number; lat: number; ele?: number } | null) => void;
  onZoomToSegment?: (segment: Segment) => void;
}

export function SegmentInfo({ segmentId, trip, allTrips, onGoBack, onUpdateTrip, hoveredCoordinate, onHoverCoordinate, onZoomToSegment }: SegmentInfoProps) {
  const seg = trip.segments.find(s => s.id === segmentId);
  const [gpxImportData, setGpxImportData] = useState<{ updatedSeg: Segment, coords: [number, number, number][], segIndex: number, newSegments: Segment[] } | null>(null);
  const [copyColorOffer, setCopyColorOffer] = useState<{ color: string, icon: string } | null>(null);
  
  const [customIconInput, setCustomIconInput] = useState<string>('');
  
  useEffect(() => {
    setCustomIconInput(seg?.customIcon || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentId, seg?.customIcon]);
  
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
          <button className="iconButton" onClick={() => {
            if (seg) {
              const gpx = exportGPX(seg, trip, true);
              downloadFile(gpx, `segment_${seg.id.slice(0, 8)}.gpx`, 'application/gpx+xml');
            }
          }} title="Export GPX">
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
                    {m === 'other' && isSelected && seg.customIcon ? <MaterialIcon name={seg.customIcon} size={24} /> : getModeIcon(m, 24)}
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
           {routingManager.getService(seg.routingService) && !routingManager.getService(seg.routingService)!.isAvailable() && seg.routingService === 'Rail Router' && (
             <button
               onClick={() => {
                 const pointsParams = seg.waypoints.map(wp => `point=${wp.coordinates[1]}%2C${wp.coordinates[0]}`).join('&');
                 window.open(`https://routing.openrailrouting.org/maps/?${pointsParams}&locale=en-GB&elevation=false&profile=all_tracks&use_miles=false&layer=OSM%20Carto`, '_blank');
               }}
               style={{
                 marginTop: '8px',
                 padding: '6px 12px',
                 backgroundColor: '#f0f0f0',
                 border: '1px solid #ccc',
                 borderRadius: '4px',
                 cursor: 'pointer',
                 fontSize: '0.85rem',
                 display: 'flex',
                 alignItems: 'center',
                 gap: '6px'
               }}
               title="Open route in openrailrouting.org"
             >
               <MaterialIcon name="open_in_new" size={16} /> Open in openrailrouting.org
             </button>
           )}
        </div>

        <div className="form-row">
          <div className="form-col" style={{ flex: 1 }}>
             <label className="form-label">Color</label>
             <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
               <input 
                 type="color" 
                 value={seg.customColor || ModeThemes[seg.transportMode]?.color || '#000000'} 
                 onChange={(e) => {
                   const newSegments = trip.segments.map(s => 
                     s.id === segmentId ? { ...s, customColor: e.target.value } : s
                   );
                   onUpdateTrip({ ...trip, segments: newSegments });
                 }}
                 style={{ width: '36px', height: '36px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer' }}
               />
               <button 
                 className="iconButton" 
                 title="Reset Color" 
                 onClick={() => {
                   const newSegments = trip.segments.map(s => {
                     if (s.id === segmentId) {
                       const { customColor, ...rest } = s;
                       return rest;
                     }
                     return s;
                   });
                   onUpdateTrip({ ...trip, segments: newSegments });
                 }}
                 style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9' }}
               >
                 <MaterialIcon name="restart_alt" size={20} />
               </button>
             </div>
          </div>

          {seg.transportMode === 'other' && (
            <div className="form-col" style={{ flex: 2 }}>
               <label className="form-label">Icon</label>
               <div style={{ display: 'flex', gap: '8px' }}>
                 <input 
                   type="text" 
                   placeholder="Custom icon name..." 
                   className="form-input" 
                   value={customIconInput}
                   onChange={(e) => {
                     setCustomIconInput(e.target.value);
                     if (e.target.value === '' && !seg?.customIcon) return;
                     const newSegments = trip.segments.map(s => 
                       s.id === segmentId ? { ...s, customIcon: e.target.value || undefined } : s
                     );
                     onUpdateTrip({ ...trip, segments: newSegments });
                   }}
                   onBlur={() => {
                     const icon = customIconInput.trim();
                     if (!icon) return;
                     
                     let foundColor = trip.segments.find(s => s.id !== segmentId && s.transportMode === 'other' && s.customIcon === icon && s.customColor)?.customColor;
                     if (!foundColor && allTrips) {
                       for (const t of allTrips) {
                         const match = t.segments.find(s => s.transportMode === 'other' && s.customIcon === icon && s.customColor);
                         if (match) {
                           foundColor = match.customColor;
                           break;
                         }
                       }
                     }
                     if (foundColor && foundColor !== seg?.customColor) {
                       setCopyColorOffer({ color: foundColor, icon });
                     }
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
                   title="Clear Icon" 
                   onClick={() => {
                     setCustomIconInput('');
                     if (!seg?.customIcon) return;
                     const newSegments = trip.segments.map(s => {
                       if (s.id === segmentId) {
                         const { customIcon, ...rest } = s;
                         return rest;
                       }
                       return s;
                     });
                     onUpdateTrip({ ...trip, segments: newSegments });
                   }}
                   style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9' }}
                 >
                   <MaterialIcon name="close" size={20} />
                 </button>
               </div>
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

      <ConfirmDialog
        isOpen={copyColorOffer !== null}
        title="Copy Color?"
        message={
          <>
            Found another segment with the custom icon "{copyColorOffer?.icon}" and a custom color
            <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: copyColorOffer?.color, marginLeft: '6px', marginRight: '2px', verticalAlign: 'middle', border: '1px solid #ccc' }}></span>
            . Do you want to copy its color?
          </>
        }
        confirmLabel="Yes, copy color"
        cancelLabel="No, thanks"
        onConfirm={() => {
          if (copyColorOffer) {
            const newSegments = trip.segments.map(s =>
              s.id === segmentId ? { ...s, customColor: copyColorOffer.color } : s
            );
            onUpdateTrip({ ...trip, segments: newSegments });
            setCopyColorOffer(null);
          }
        }}
        onCancel={() => setCopyColorOffer(null)}
      />
    </>
  );
}