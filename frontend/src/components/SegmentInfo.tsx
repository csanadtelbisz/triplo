import { useState, useEffect } from 'react';
import { TRANSPORT_MODES, type Trip, type Segment } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { getModeColor, getModeName, getModeRoutingProfile } from '../utils/builtInModesPreferences';
import { exportGPX, downloadFile } from '../utils/exportUtils';
import { routingManager, route } from '../routing/RoutingService';
import { ElevationProfile } from './ElevationProfile';
import { ConfirmDialog } from './Dialog';
import { useCopySegmentMetadata } from '../utils/useCopySegmentMetadata';
import { CopySegmentMetadataDialog } from './CopySegmentMetadataDialog';
import { getCustomOtherModes } from '../utils/customModesPreferences';
import type { CustomOtherMode } from '../utils/customModesPreferences';
import { IconPickerDialog } from './IconPickerDialog';

interface SegmentInfoProps {
  isReadOnly?: boolean;
  segmentId: string;
  trip: Trip;
  allTrips?: Trip[];
  onGoBack: () => void;
  onUpdateTrip: (newTrip: Trip) => void;
  hoveredCoordinate?: { lon: number; lat: number; ele?: number } | null;
  onHoverCoordinate?: (coord: { lon: number; lat: number; ele?: number } | null) => void;
  onZoomToSegment?: (segment: Segment) => void;
}

export function SegmentInfo({ isReadOnly, segmentId, trip, allTrips, onGoBack, onUpdateTrip, hoveredCoordinate, onHoverCoordinate, onZoomToSegment }: SegmentInfoProps) {
  const seg = trip.segments.find(s => s.id === segmentId);
  const [gpxImportData, setGpxImportData] = useState<{ updatedSeg: Segment, coords: [number, number, number][], segIndex: number, newSegments: Segment[] } | null>(null);
  
  const { sectionMetadataOffer, applySectionMetadataOffer, cancelSectionMetadataOffer, handleNameChange, handleIconChange } = useCopySegmentMetadata(trip, allTrips, onUpdateTrip);
  const [showAllProfiles, setShowAllProfiles] = useState(false);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  
  useEffect(() => {
    setShowAllProfiles(false);
  }, [segmentId]);
  const [customIconInput, setCustomIconInput] = useState<string>('');
  const [customModes, setCustomModes] = useState<CustomOtherMode[]>(() => getCustomOtherModes());

  useEffect(() => {
    const handlePrefsUpdated = () => {
      setCustomModes(getCustomOtherModes());
    };
    window.addEventListener('preferences-updated', handlePrefsUpdated);
    return () => window.removeEventListener('preferences-updated', handlePrefsUpdated);
  }, []);

  useEffect(() => {
    setCustomIconInput(seg?.customIcon || '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segmentId, seg?.customIcon]);
  
  const handleImportTrack = () => {
    if (!seg) return;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.gpx,.geojson,.json';
    fileInput.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      
      const coords: [number, number, number][] = [];

      if (file.name.toLowerCase().endsWith('.geojson') || file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{')) {
        try {
          const geojson = JSON.parse(text);
          const extractCoords = (geometry: any) => {
            if (geometry.type === 'LineString') {
               geometry.coordinates.forEach((c: any) => coords.push([c[0], c[1], c[2] || 0]));
            } else if (geometry.type === 'MultiLineString') {
               geometry.coordinates.forEach((line: any) => line.forEach((c: any) => coords.push([c[0], c[1], c[2] || 0])));
            }
          };
          if (geojson.type === 'FeatureCollection') {
            geojson.features.forEach((f: any) => {
              if (f.geometry) extractCoords(f.geometry);
            });
          } else if (geojson.type === 'Feature') {
            if (geojson.geometry) extractCoords(geojson.geometry);
          } else if (geojson.type === 'LineString' || geojson.type === 'MultiLineString') {
            extractCoords(geojson);
          }
        } catch (e) {
          console.error(e);
          alert("Could not parse GeoJSON file.");
          return;
        }
      } else {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
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
      }

      if (coords.length < 2) {
        alert("Could not find valid route coordinates in file.");
        return;
      }

      const newSegments = [...trip.segments];
      const segIndex = newSegments.findIndex(s => s.id === segmentId);
      const updatedSeg = { 
          ...newSegments[segIndex], 
          routingService: 'gpx', 
          routingProfile: 'Imported Track',
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
          {!isReadOnly && (
            <button
              className="iconButton"
              onClick={() => {
                const newSegments = trip.segments.map(s =>
                  s.id === segmentId ? { ...s, isHidden: !s.isHidden } : s
                );
                onUpdateTrip({ ...trip, segments: newSegments });
              }}
              title={seg.isHidden ? "Segment is hidden on map" : "Segment is visible"}
              style={{ color: seg.isHidden ? '#999' : 'inherit' }}
            >
              <MaterialIcon name={seg.isHidden ? "visibility_off" : "visibility"} size={20} />
            </button>
          )}
            <button
                className="iconButton"
                onClick={() => {
                  if (onZoomToSegment) {
                    onZoomToSegment(seg);
                  }
                }}
                title="Focus to Segment"
            >
              <MaterialIcon name="my_location" size={20} />
            </button>          <button className="iconButton" onClick={handleImportTrack} disabled={isReadOnly} title="Import Track">
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
             disabled={isReadOnly}
             className="form-input" 
             onBlur={(e) => {
               const newValue = e.target.value;
               if (!handleNameChange(segmentId, seg?.name, newValue)) {
                 if (newValue !== (seg?.name || '')) {
                   const newSegments = trip.segments.map(s =>
                     s.id === segmentId ? { ...s, name: newValue } : s
                   );
                   onUpdateTrip({ ...trip, segments: newSegments });
                 }
               }
             }}
           />
        </div>
        <div className="form-group">
           <label className="form-label">Transport Mode</label>
           <div className="mode-selector">
              {TRANSPORT_MODES.filter(m => m !== 'other').map(m => {
                const themeColor = getModeColor(m);
                const isSelected = seg.transportMode === m;
                return (
                  <button
                    key={m}
                    title={getModeName(m)}
                    disabled={isReadOnly}
                    className="mode-button"
                    style={{
                      border: isSelected ? `2px solid ${themeColor || '#007bff'}` : '1px solid #ddd',
                      background: isSelected ? `${themeColor || '#007bff'}22` : 'white',
                      color: themeColor,
                      opacity: isSelected || !isReadOnly ? 1 : 0.3,
                      cursor: isReadOnly ? 'default' : 'pointer',
                    }}
                    onClick={async () => {
                      if (!isSelected) {
                        const defRouter = routingManager.getDefaultRouter(m);
                        const assignedProfileStr = getModeRoutingProfile(m, defRouter.serviceName, defRouter.profile);
                        const [svc, prof] = assignedProfileStr.split('|');

                        const newSegments = [...trip.segments];
                        const segIndex = newSegments.findIndex(s => s.id === segmentId);
                        const updatedSeg = {
                          ...newSegments[segIndex],
                          customColor: undefined,
                          transportMode: m,
                          routingService: svc || defRouter.serviceName,
                          routingProfile: prof || defRouter.profile,
                          source: 'router' as const
                        };
                        setShowAllProfiles(false);

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
              
              {customModes.filter(cm => cm.showInList !== false).map(cm => {
                const isSelected = seg.transportMode === 'other' && seg.customIcon === cm.icon;
                return (
                  <button
                    key={`custom-${cm.icon}`}
                    title={cm.name.toLowerCase() || cm.icon.replaceAll("_", " ").toLowerCase()}
                    disabled={isReadOnly}
                    className="mode-button"
                    style={{
                      border: isSelected ? `2px solid ${cm.color || '#007bff'}` : '1px solid #ddd',
                      background: isSelected ? `${cm.color || '#007bff'}22` : 'white',
                      color: cm.color,
                      opacity: isSelected || !isReadOnly ? 1 : 0.3,
                      cursor: isReadOnly ? 'default' : 'pointer',
                    }}
                    onClick={async () => {
                      if (!isSelected) {
                        const newSegments = [...trip.segments];
                        const segIndex = newSegments.findIndex(s => s.id === segmentId);
                        
                        let service = 'Straight Line Router';
                        let profile = 'straight_line';
                        if (cm.routingProfile && cm.routingProfile.includes('|')) {
                          [service, profile] = cm.routingProfile.split('|');
                        } else if (cm.routingProfile) {
                          profile = cm.routingProfile; // Fallback
                        }

                        const updatedSeg = {
                          ...newSegments[segIndex],
                          customColor: cm.color,
                          transportMode: 'other' as const,
                          customIcon: cm.icon,
                          routingService: service,
                          routingProfile: profile,
                          source: 'router' as const
                        };
                        setShowAllProfiles(false);

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
                    <MaterialIcon name={cm.icon} size={24} />
                  </button>
                );
              })}

              {/* Keep the original 'other' handler at the end */}
              {TRANSPORT_MODES.filter(m => m === 'other').map(m => {
                // Should only be indicated if customIcon doesn't match any custom modes, 
                // but visually distinguishing it is nice if they selected a built-in other mode manually.
                const isModeSelected = seg.transportMode === m;
                const isBuiltinSelected = isModeSelected && !customModes.some(cm => cm.showInList !== false && cm.icon === seg.customIcon);
                const themeColor = (isBuiltinSelected ? seg.customColor : undefined) || getModeColor(m);
                return (
                  <button
                    key={m}
                    title={getModeName(m)}
                    disabled={isReadOnly}
                    className="mode-button"
                    style={{
                      border: isBuiltinSelected ? `2px solid ${themeColor || '#007bff'}` : '1px solid #ddd',
                      background: isBuiltinSelected ? `${themeColor || '#007bff'}22` : 'white',
                      color: themeColor,
                      opacity: isBuiltinSelected || !isReadOnly ? 1 : 0.3,
                      cursor: isReadOnly ? 'default' : 'pointer',
                    }}
                    onClick={async () => {
                      if (!isBuiltinSelected) {
                        const defRouter = routingManager.getDefaultRouter(m);
                        const assignedProfileStr = getModeRoutingProfile(m, defRouter.serviceName, defRouter.profile);
                        const [svc, prof] = assignedProfileStr.split('|');

                        const newSegments = [...trip.segments];
                        const segIndex = newSegments.findIndex(s => s.id === segmentId);
                        const updatedSeg = {
                          ...newSegments[segIndex],
                          customColor: undefined,
                          transportMode: m,
                          customIcon: undefined,
                          routingService: svc || defRouter.serviceName,
                          routingProfile: prof || defRouter.profile,
                          source: 'router' as const
                        };
                        setShowAllProfiles(false);

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

                        setIsIconPickerOpen(true);
                      }
                    }}
                  >
                    {isBuiltinSelected && seg.customIcon ? <MaterialIcon name={seg.customIcon} size={24} /> : getModeIcon(m, 24)}
                  </button>
                );
              })}
           </div>
        </div>
        <div className="form-group">
           <label className="form-label">Routing Profile</label>
           <select 
             className="form-input" 
             disabled={isReadOnly}
             value={seg.routingService === 'gpx' ? 'gpx|Imported Track' : `${seg.routingService}|${seg.routingProfile}`}
             onChange={async (e) => {
               const [service, profile] = e.target.value.split('|');
               if (service === 'all') {
                 setShowAllProfiles(true);
                 return;
               }
               if (service === 'gpx') {
                 handleImportTrack();
                 return;
               }
               const newSegments = [...trip.segments];
               const segIndex = newSegments.findIndex(s => s.id === segmentId);
                 const updatedSeg = { ...newSegments[segIndex], routingService: service, routingProfile: profile, source: 'router' as const };
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
                 svc.getRoutingProfiles((showAllProfiles || seg.transportMode === 'other') ? 'other' : seg.transportMode).map(profile => (
                   <option key={`${svc.name}|${profile}`} value={`${svc.name}|${profile}`}>
                     {svc.name.replace(' Router', '')} [{profile}]
                   </option>
                 ))
             )}
             <option value="gpx|Imported Track">Imported Track</option>
             {seg.transportMode !== 'other' && !showAllProfiles &&
               <option value="all|Show All">Show All Options</option>
             }
           </select>
           {routingManager.getService(seg.routingService) && !routingManager.getService(seg.routingService)!.isAvailable() && (
             <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '4px' }}>
               Routing service currently unavailable: routes default to straight lines. Open an online routing service, download the route, and import it as GPX or GeoJSON here.
             </div>
           )}
           {routingManager.getService(seg.routingService) && !routingManager.getService(seg.routingService)!.isAvailable() && seg.routingService === 'Rail Router' && (
             <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
               <button
                 onClick={() => {
                   const pointsParams = seg.waypoints.map(wp => `${wp.coordinates[1]},${wp.coordinates[0]}`).join(';');
                   window.open(`https://signal.eu.org/osm/#locs=${pointsParams}`, '_blank');
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
                 title="Open route in signal.eu.org"
               >
                 <MaterialIcon name="open_in_new" size={16} /> Open in signal.eu.org
               </button>
             </div>
           )}
           {routingManager.getService(seg.routingService) && seg.routingService === 'GraphHopper Router' && seg.routingProfile === 'ferry' && (
             <div>
                <div style={{ color: 'red', fontSize: '0.8rem', marginTop: '4px' }}>
                  Custom routing models are not available in the free GraphHopper API. You can calculate the route with custom models in GraphHopper's web version, export it as GPX, and import it here.
                </div>
                <button
                  onClick={() => {
                    const pointsParams = seg.waypoints.map(wp => `point=${wp.coordinates[1]}%2C${wp.coordinates[0]}`).join('&');
                    const customModel = encodeURIComponent(JSON.stringify({
                      priority: [
                        {
                          if: "road_environment!=FERRY",
                          multiply_by: "0.1"
                        }
                      ]
                    }));
                    window.open(`https://graphhopper.com/maps/?${pointsParams}&profile=car&custom_model=${customModel}`, '_blank');
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
                >
                  <MaterialIcon name="open_in_new" size={16} /> Open in GraphHopper Maps
                </button>
              </div>
           )}
        </div>

        <div className="form-row">
          <div className="form-col" style={{ flex: 1 }}>
             <label className="form-label">Color</label>
             <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
               <input 
                 type="color" 
                 value={seg.customColor || getModeColor(seg.transportMode) || '#000000'} 
                 disabled={isReadOnly}
                 onChange={(e) => {
                   const newSegments = trip.segments.map(s => 
                     s.id === segmentId ? { ...s, customColor: e.target.value } : s
                   );
                   onUpdateTrip({ ...trip, segments: newSegments });
                 }}
                 style={{ width: '36px', height: '36px', padding: 0, border: 'none', borderRadius: '4px', cursor: isReadOnly ? 'default' : 'pointer', opacity: isReadOnly ? 0.7 : 1 }}
               />
               <button 
                 className="iconButton" 
                 title="Reset Color" 
                 disabled={isReadOnly}
                 onClick={() => {
                   const newSegments = trip.segments.map(s => {
                     if (s.id === segmentId) {
                       if (s.transportMode === 'other' && s.customIcon) { const cm = customModes.find(m => m.icon === s.customIcon); if (cm) return { ...s, customColor: cm.color }; }
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

          {seg.transportMode === 'other' && !customModes.some(cm => cm.showInList !== false && cm.icon === seg.customIcon) && (
            <div className="form-col" style={{ flex: 2 }}>
               <label className="form-label">Icon</label>
               <div style={{ display: 'flex', gap: '8px' }}>
                 <input 
                   type="text" 
                   placeholder="Custom icon name..." 
                   className="form-input" 
                   disabled={true}
                   value={customIconInput}
                   onChange={(e) => {
                     setCustomIconInput(e.target.value);
                     if (e.target.value === '' && !seg?.customIcon) return;
                     
                     const typedIcon = e.target.value;
                     const matchedMode = customModes.find(cm => cm.icon === typedIcon);
                     
                     const newSegments = trip.segments.map(s => {
                       if (s.id === segmentId) {
                         const updates: any = { customIcon: typedIcon || undefined };
                         if (matchedMode) {
                           updates.customColor = matchedMode.color;
                         }
                         return { ...s, ...updates };
                       }
                       return s;
                     });
                     onUpdateTrip({ ...trip, segments: newSegments });
                   }}
                   onBlur={() => {
                     const icon = customIconInput.trim();
                     handleIconChange(segmentId, seg?.customIcon, seg?.customColor, icon);
                   }}
                   onFocus={(e) => e.target.select()}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') {
                       e.currentTarget.blur();
                     }
                   }}
                 />
                 <button 
                   type="button"
                   disabled={isReadOnly}
                   onClick={() => setIsIconPickerOpen(true)}
                   className="iconButton" 
                   title="Search Icons" 
                   style={{ width: '36px', height: '36px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: '4px', background: '#f9f9f9', cursor: isReadOnly ? 'default' : 'pointer' }}
                 >
                   <MaterialIcon name="search" size={20} />
                 </button>
                 <button 
                   className="iconButton" 
                   title="Clear Icon" 
                   disabled={isReadOnly}
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

        {/* <div className="form-group" style={{ marginTop: 24 }}>
          <label className="form-label">ID (Read-only)</label>
          <input type="text" readOnly value={seg.id} className="form-input" />
        </div> */}
        {/* <div className="form-group">
           <label className="form-label">Source (Read-only)</label>
           <input type="text" readOnly value={seg.source} className="form-input" />
        </div> */}
      </div>

      <ConfirmDialog
        isOpen={gpxImportData !== null}
        title="Adjust Waypoints"
        message="Do you want to adjust the first and last waypoints of this segment to match the newly imported track?"
        confirmLabel="Yes, adjust them"
        cancelLabel="No, keep them"
        onConfirm={() => handleConfirmGPXWaypoints(true)}
        onCancel={() => handleConfirmGPXWaypoints(false)}
      />

      <CopySegmentMetadataDialog offer={sectionMetadataOffer} onConfirm={() => applySectionMetadataOffer(segmentId)} onCancel={cancelSectionMetadataOffer} />

      <IconPickerDialog
        isOpen={isIconPickerOpen}
        onClose={() => setIsIconPickerOpen(false)}
        onPick={(iconId) => {
          setCustomIconInput(iconId);
          const matchedMode = customModes.find(cm => cm.icon === iconId);
          
          const newSegments = trip.segments.map(s => {
            if (s.id === segmentId) {
              const updates: any = { customIcon: iconId };
              if (matchedMode) {
                updates.customColor = matchedMode.color;
              }
              return { ...s, ...updates };
            }
            return s;
          });
          onUpdateTrip({ ...trip, segments: newSegments });
          
          // Trigger the metadata copy offer check
          handleIconChange(segmentId, seg?.customIcon, seg?.customColor, iconId);
        }}
      />
    </>
  );
}