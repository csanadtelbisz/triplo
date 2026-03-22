import { useEffect, useRef, useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Trip, Segment, Waypoint } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';
import { route } from '../routing';

interface TripEditorProps {
  trip: Trip;
  onGoBack: () => void;
  onSelectSegment: (segmentId: string) => void;
  onSelectWaypoint: (waypointId: string) => void;
  onZoomToTrip: () => void;
  onJumpToWaypoint: (waypointId: string) => void;
  highlightedWaypointId?: string | null;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSave: () => void;
  canSave: boolean;
  onUpdateTrip: (newTrip: Trip) => void;
  onWaitingForCoords: (waypointId: string | null) => void;
}

export function TripEditor({
  trip, onGoBack, onSelectSegment, onSelectWaypoint,
  onZoomToTrip, onJumpToWaypoint, highlightedWaypointId,
  onUndo, onRedo, canUndo, canRedo, onSave, canSave, onUpdateTrip,
  onWaitingForCoords
}: TripEditorProps) {
  const waypointRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const [focusedWaypointWithoutCoords, setFocusedWaypointWithoutCoords] = useState<string | null>(null);

  useEffect(() => {
    if (highlightedWaypointId && waypointRefs.current[highlightedWaypointId]) {
      waypointRefs.current[highlightedWaypointId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Add a brief highlight flash
      const el = waypointRefs.current[highlightedWaypointId];
      if (el) {
        el.style.transition = 'background-color 0.5s';
        el.style.backgroundColor = '#e6f2ff';
        
        const input = el.querySelector('.waypoint-title-input') as HTMLInputElement | null;
        if (input) {
          input.focus();
        }
        
        setTimeout(() => {
          el.style.backgroundColor = 'white';
        }, 1000);
      }
    }
  }, [highlightedWaypointId]);

  const handleTitleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      const inputs = Array.from(document.querySelectorAll('.waypoint-title-input')) as HTMLInputElement[];
      const currentIndex = inputs.indexOf(e.currentTarget);
      
      if (currentIndex > -1) {
        if (e.shiftKey) {
          if (currentIndex > 0) {
            e.preventDefault();
            inputs[currentIndex - 1].focus();
          }
        } else {
          if (currentIndex < inputs.length - 1) {
            e.preventDefault();
            inputs[currentIndex + 1].focus();
          }
        }
      }
    }
  };

  const handleSegmentTitleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      const inputs = Array.from(document.querySelectorAll('.segment-title-textarea')) as HTMLTextAreaElement[];
      const currentIndex = inputs.indexOf(e.currentTarget);
      
      if (currentIndex > -1) {
        if (e.shiftKey) {
          if (currentIndex > 0) {
            e.preventDefault();
            inputs[currentIndex - 1].focus();
          }
        } else {
          if (currentIndex < inputs.length - 1) {
            e.preventDefault();
            inputs[currentIndex + 1].focus();
          }
        }
      }
    }
  };

  const globalWaypoints = trip.segments.flatMap((seg, i) => 
    seg.waypoints.slice(0, i === trip.segments.length - 1 ? undefined : -1)
  );
  
  const boundaryIds = trip.segments.map(s => s.waypoints[0].id);
  
  const segmentStartGlobalIndices = trip.segments.map((_, i) => {
    let sum = 0;
    for (let j = 0; j < i; j++) sum += trip.segments[j].waypoints.length - 1;
    return sum;
  });

  const applyGlobalWaypoints = async (newGlobalWaypoints: Waypoint[]) => {
    const newSegments = [];
    for (let i = 0; i < trip.segments.length; i++) {
      const seg = trip.segments[i];
let startId = i === 0 ? newGlobalWaypoints[0].id : seg.waypoints[0].id;
      let startIndex = newGlobalWaypoints.findIndex(w => w.id === startId);
      if (startIndex === -1 && seg.waypoints.length > 1) {
        startId = seg.waypoints[1].id;
        startIndex = newGlobalWaypoints.findIndex(w => w.id === startId);
      }

      let endIndex = i === trip.segments.length - 1
        ? newGlobalWaypoints.length - 1
        : newGlobalWaypoints.findIndex(w => w.id === trip.segments[i + 1].waypoints[0].id);

      if (endIndex === -1 && i + 1 < trip.segments.length && trip.segments[i + 1].waypoints.length > 1) {
        endIndex = newGlobalWaypoints.findIndex(w => w.id === trip.segments[i + 1].waypoints[1].id);
      }

      const expectedWaypoints = newGlobalWaypoints.slice(startIndex, endIndex + 1);
      
      const changed = expectedWaypoints.length !== seg.waypoints.length || 
                      expectedWaypoints.some((w, idx) => w.id !== seg.waypoints[idx].id);

      if (changed) {
        newSegments.push(await updateSegmentRoute({ ...seg, waypoints: expectedWaypoints }));
      } else {
        newSegments.push(seg);
      }
    }
    onUpdateTrip({ ...trip, segments: newSegments });
  };

  const handleMoveWaypointEarlier = async (wpId: string) => {
    const idx = globalWaypoints.findIndex(w => w.id === wpId);
    if (idx <= 0) return;

    const currIsBoundary = boundaryIds.includes(wpId);
    const prevIsBoundary = boundaryIds.includes(globalWaypoints[idx - 1].id);
    if (currIsBoundary && prevIsBoundary) return;

    const newGlobal = [...globalWaypoints];
    const temp = newGlobal[idx - 1];
    newGlobal[idx - 1] = newGlobal[idx];
    newGlobal[idx] = temp;

    await applyGlobalWaypoints(newGlobal);
  };

  const handleMoveWaypointLater = async (wpId: string) => {
    const idx = globalWaypoints.findIndex(w => w.id === wpId);
    if (idx < 0 || idx >= globalWaypoints.length - 1) return;

    const currIsBoundary = boundaryIds.includes(wpId);
    const nextIsBoundary = boundaryIds.includes(globalWaypoints[idx + 1].id);
    if (currIsBoundary && nextIsBoundary) return;

    const newGlobal = [...globalWaypoints];
    const temp = newGlobal[idx + 1];
    newGlobal[idx + 1] = newGlobal[idx];
    newGlobal[idx] = temp;

    await applyGlobalWaypoints(newGlobal);
  };

  const handleRemoveWaypoint = async (wpId: string) => {
    const idx = globalWaypoints.findIndex(w => w.id === wpId);
    if (idx === -1) return;
    if (boundaryIds.includes(wpId) && boundaryIds.includes(globalWaypoints[idx + 1]?.id)) return;

    if (idx === globalWaypoints.length - 1) {
      const lastSeg = trip.segments[trip.segments.length - 1];
      if (lastSeg.waypoints[0].id === wpId) return;
    }

    const newGlobal = globalWaypoints.filter(w => w.id !== wpId);
    await applyGlobalWaypoints(newGlobal);
  };

  const handleInsertWaypoint = async (wpId: string, position: 'before' | 'after') => {
    const idx = globalWaypoints.findIndex(w => w.id === wpId);
    if (idx === -1) return;

    const newWaypoint: Waypoint = {
      id: `wp_${Math.random().toString(36).substring(2, 9)}`,
      coordinates: [] as any, 
      importance: 'normal',
      name: '',
    };

    const newGlobal = [...globalWaypoints];
    const insertIdx = position === 'before' ? idx : idx + 1;
    newGlobal.splice(insertIdx, 0, newWaypoint);

    await applyGlobalWaypoints(newGlobal);

    setTimeout(() => {
      // Focus the newly added waypoint input
      const inputs = Array.from(document.querySelectorAll('.waypoint-title-input')) as HTMLInputElement[];
      const el = inputs.find(input => input.getAttribute('data-wpid') === newWaypoint.id);
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const updateSegmentRoute = async (segment: Segment): Promise<Segment> => {
    if (segment.source === 'router') {
        const coords = segment.waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map(wp => wp.coordinates);
        if (coords.length < 2) return segment;
        const geometry = await route(coords, segment.routingMode);
        return { ...segment, geometry };
      }
      return segment;
    };

  const handleStartEarlier = async (segIndex: number) => {
    if (segIndex === 0) return;
    const prevSeg = trip.segments[segIndex - 1];
    if (prevSeg.waypoints.length <= 2) return;

    const newSegments = [...trip.segments];
    const newPrevSeg = { ...prevSeg, waypoints: [...prevSeg.waypoints] };
    const newCurrSeg = { ...newSegments[segIndex], waypoints: [...newSegments[segIndex].waypoints] };

    const boundaryWaypoint = newPrevSeg.waypoints[newPrevSeg.waypoints.length - 2];
    
    newPrevSeg.waypoints.pop();
    newCurrSeg.waypoints.unshift(boundaryWaypoint);

    newSegments[segIndex - 1] = await updateSegmentRoute(newPrevSeg);
    newSegments[segIndex] = await updateSegmentRoute(newCurrSeg);
    onUpdateTrip({ ...trip, segments: newSegments });
  };

  const handleStartLater = async (segIndex: number) => {
    if (segIndex === 0) return;
    const currSeg = trip.segments[segIndex];
    if (currSeg.waypoints.length <= 2) return;

    const newSegments = [...trip.segments];
    const newPrevSeg = { ...newSegments[segIndex - 1], waypoints: [...newSegments[segIndex - 1].waypoints] };
    const newCurrSeg = { ...currSeg, waypoints: [...currSeg.waypoints] };

    const boundaryWaypoint = newCurrSeg.waypoints[1];

    newPrevSeg.waypoints.push(boundaryWaypoint);
    newCurrSeg.waypoints.shift();

    newSegments[segIndex - 1] = await updateSegmentRoute(newPrevSeg);
    newSegments[segIndex] = await updateSegmentRoute(newCurrSeg);
    onUpdateTrip({ ...trip, segments: newSegments });
  };

  const handleDeleteSegment = async (segIndex: number) => {
    if (segIndex === 0) return;
    const newSegments = [...trip.segments];
    const prevSeg = { ...newSegments[segIndex - 1], waypoints: [...newSegments[segIndex - 1].waypoints] };
    const currSeg = newSegments[segIndex];

    prevSeg.waypoints.push(...currSeg.waypoints.slice(1));
    newSegments[segIndex - 1] = await updateSegmentRoute(prevSeg);
    newSegments.splice(segIndex, 1);
    onUpdateTrip({ ...trip, segments: newSegments });
  };

  const handleSplitSegment = useCallback(async (segIndex: number, wpIndex: number) => {
    const seg = trip.segments[segIndex];
    if (wpIndex === 0 || wpIndex === seg.waypoints.length - 1) return;

    const newSegments = [...trip.segments];
    // Generate an ID based on highest existing segment number suffix if possible, or just a unique id.
    const maxId = trip.segments.reduce((max, s) => {
      const match = s.id.match(/^seg_(\d+)/);
      return match ? Math.max(max, parseInt(match[1])) : max;
    }, 0);
    const uniqueSuffix = Math.random().toString(36).substring(2, 7);
    const newId = `seg_${maxId + 1}_new_${uniqueSuffix}`;
    
    const firstPart = {
      ...seg,
      waypoints: seg.waypoints.slice(0, wpIndex + 1)
    };

    const secondPart = {
      ...seg,
      id: newId,
      waypoints: seg.waypoints.slice(wpIndex)
    };

    newSegments.splice(
      segIndex, 
      1, 
      await updateSegmentRoute(firstPart), 
      await updateSegmentRoute(secondPart)
    );
    onUpdateTrip({ ...trip, segments: newSegments });
  }, [trip, onUpdateTrip]);

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack}><MaterialIcon name="arrow_back" size={20} /></button>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Edit Trip</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
           <button className="iconButton" title="Undo" onClick={onUndo} disabled={!canUndo}><MaterialIcon name="undo" size={20} /></button>
           <button className="iconButton" title="Redo" onClick={onRedo} disabled={!canRedo}><MaterialIcon name="redo" size={20} /></button>
           <button className="iconButton" title="Zoom to Trip" onClick={onZoomToTrip}><MaterialIcon name="zoom_out_map" size={20} /></button>
           <button className="iconButton" title="Save" onClick={onSave} disabled={!canSave} style={{ color: canSave ? '#007bff' : 'inherit' }}><MaterialIcon name="save" size={20} /></button>
           <button className="iconButton" title="Export GPX"><MaterialIcon name="ios_share" size={20} /></button>
        </div>
      </div>
      <div className="content">
         <input 
            key={`title-${trip.name}`}
            className="form-input title-input"
            defaultValue={trip.name}
            onBlur={(e) => {
              if (e.target.value !== trip.name) {
                onUpdateTrip({ ...trip, name: e.target.value });
              }
            }}
         />
         <textarea 
            key={`desc-${trip.description}`}
            className="form-textarea"
            defaultValue={trip.description}
            onBlur={(e) => {
              if (e.target.value !== trip.description) {
                onUpdateTrip({ ...trip, description: e.target.value });
              }
            }}
         />
         <div className="form-row">
           <div className="form-col">
             <label className="form-label">Start Date</label>
             <input 
               type="date" 
               className="form-input"
               defaultValue={trip.startDate ? trip.startDate.split('T')[0] : ''}
             />
           </div>
           <div className="form-col">
             <label className="form-label">End Date</label>
             <input 
               type="date" 
               className="form-input"
               defaultValue={trip.endDate ? trip.endDate.split('T')[0] : ''}
             />
           </div>
         </div>
         <div className="segments-container">
             {trip.segments.map((seg, segIndex) => {
               const baseGlobalIndex = segmentStartGlobalIndices[segIndex];
               return (
               <div key={seg.id} className="segment-row" style={{ flexDirection: 'row', position: 'relative' }}>
                 {/* Segment Toolbox */}
                 <div className="segment-toolbox">
                   <textarea 
                     key={`seg-${seg.id}-${seg.name || seg.detailedMode}`}
                     className="segment-title-textarea"
                     defaultValue={seg.name || seg.detailedMode}
                     onKeyDown={handleSegmentTitleKeyDown}
                     onBlur={(e) => {
                       if (e.target.value !== (seg.name || seg.detailedMode) && e.target.value !== seg.name) {
                         const newSegments = [...trip.segments];
                         newSegments[segIndex] = { ...seg, name: e.target.value };
                         onUpdateTrip({ ...trip, segments: newSegments });
                       }
                     }}
                   />
                   <div className="segment-tools-row">
                      <button 
                        className="iconButton" 
                        style={{ padding: '4px', color: ModeThemes[seg.detailedMode]?.color || '#007bff' }} 
                        title={`Switch mode: ${seg.detailedMode}`}
                        onClick={() => {
                          const modes = ['walk', 'hike', 'run', 'car', 'flight', 'train', 'light_rail', 'tram', 'ferry', 'waterway'] as const;
                          const currentIndex = modes.indexOf(seg.detailedMode);
                          const nextMode = modes[(currentIndex + 1) % modes.length];
                          const newSegments = [...trip.segments];
                          newSegments[segIndex] = { ...seg, detailedMode: nextMode };
                          onUpdateTrip({ ...trip, segments: newSegments });
                        }}
                      >
                       {getModeIcon(seg.detailedMode, 18)}
                     </button>
                     <button className="iconButton" style={{ padding: '4px' }} title="Segment Info" onClick={() => onSelectSegment(seg.id)}>
                       <MaterialIcon name="info" size={18} />
                     </button>
                   </div>
                   <div className="segment-tools-grid">
                     <button 
                       className="iconButton" 
                       style={{ padding: '4px' }} 
                       title="Start earlier" 
                       disabled={segIndex === 0 || trip.segments[segIndex - 1].waypoints.length <= 2}
                       onClick={() => handleStartEarlier(segIndex)}
                     >
                       <MaterialIcon name="arrow_upward" size={16} />
                     </button>
                     <button 
                       className="iconButton" 
                       style={{ padding: '4px' }} 
                       title="Start later" 
                       disabled={segIndex === 0 || seg.waypoints.length <= 2}
                       onClick={() => handleStartLater(segIndex)}
                     >
                       <MaterialIcon name="arrow_downward" size={16} />
                     </button>
                     <button 
                       className="iconButton" 
                       style={{ padding: '4px' }} 
                       title="Delete segment" 
                       disabled={segIndex === 0}
                       onClick={() => handleDeleteSegment(segIndex)}
                     >
                       <MaterialIcon name="delete" size={16} style={{ color: segIndex === 0 ? 'inherit' : '#d9534f' }} />
                     </button>
                   </div>
                 </div>

                 {/* Waypoints for this segment */}
                 <div className="segment-waypoints">
                   {seg.waypoints.map((wp, wpIndex) => {
                     const isLastInSeg = wpIndex === seg.waypoints.length - 1;
                     const isLastSegment = segIndex === trip.segments.length - 1;
                     
                     // Do not render the last waypoint of a segment unless it's the very last segment of the trip
                     if (isLastInSeg && !isLastSegment) {
                       return null; // Let the next segment render this shared waypoint
                     }

                     const isLastTripWaypoint = isLastSegment && isLastInSeg;
                     
                     const isFirstInSeg = wpIndex === 0;
                     const currSegColor = ModeThemes[seg.detailedMode]?.color || '#007bff';
                     const prevSegColor = segIndex > 0 ? (ModeThemes[trip.segments[segIndex - 1].detailedMode]?.color || '#007bff') : currSegColor;
                     
                     const globalIndex = baseGlobalIndex + wpIndex;
                     const canMoveEarlier = globalIndex > 0 && !(boundaryIds.includes(wp.id) && boundaryIds.includes(globalWaypoints[globalIndex - 1]?.id));
                     const canMoveLater = globalIndex >= 0 && globalIndex < globalWaypoints.length - 1 && !(boundaryIds.includes(wp.id) && boundaryIds.includes(globalWaypoints[globalIndex + 1]?.id));
                     const canRemove = !(isFirstInSeg && boundaryIds.includes(globalWaypoints[globalIndex + 1]?.id)) && !(isLastTripWaypoint && isFirstInSeg);
                     
                     const topLineColor = (isFirstInSeg && segIndex > 0) ? prevSegColor : currSegColor;
                     const bottomLineColor = currSegColor;
                     
                     return (
                       <div 
                         key={`${seg.id}-${wp.id}`} 
                         className={`waypoint-row ${highlightedWaypointId === wp.id ? 'selected' : ''}`}
                         ref={(el) => { waypointRefs.current[wp.id] = el; }}
                       >
                         
                         {/* Timeline Column (Continuous) */}
                         <div className="timeline-col">
                           {/* Top Half Line */}
                           <div className="timeline-line top" style={{ background: topLineColor }}></div>
                           {/* Bottom Half Line */}
                           <div className="timeline-line bottom" style={{ background: bottomLineColor }}></div>
                           
                           {/* Plus Button (Top boundary) */}
                           <div 
                             className="timeline-plus top-pos" 
                             title="Add Waypoint Here"
                             onClick={() => handleInsertWaypoint(wp.id, 'before')}
                           >
                             <MaterialIcon name="add" size={14} style={{ color: '#666' }} />
                           </div>

                           {/* Plus Button (Bottom boundary - only for last point) */}
                           {isLastTripWaypoint && (
                             <div 
                               className="timeline-plus bottom-pos" 
                               title="Add Waypoint Here"
                               onClick={() => handleInsertWaypoint(wp.id, 'after')}
                             >
                               <MaterialIcon name="add" size={14} style={{ color: '#666' }} />
                             </div>
                           )}

                           {/* Dot */}
                           <div className="timeline-dot" style={{ 
                             background: wp.importance === 'hidden' 
                               ? 'white'
                               : ((isFirstInSeg && segIndex > 0) ? `linear-gradient(to bottom, ${prevSegColor} 50%, ${currSegColor} 50%)` : currSegColor), 
                             border: wp.importance === 'hidden' ? `3px solid ${currSegColor}` : 'none'
                           }}>
                           </div>
                         </div>

                         {/* Waypoint Content */}
                         <div className="waypoint-content">
                           <div className="waypoint-card">
                             <input
                                 key={`wpt-${wp.id}-${wp.name}`}
                                 type="text"
                                 defaultValue={wp.name || ''}
                                 placeholder={(!wp.coordinates || (wp.coordinates as any).length < 2) ? (focusedWaypointWithoutCoords === wp.id ? "Select a point on the map" : "Focus to set coordinates") : `${wp.coordinates[1].toFixed(5)}, ${wp.coordinates[0].toFixed(5)}`}
                                 className="waypoint-title-input"
                                 data-wpid={wp.id}
                                 onFocus={() => {
                                   if (!wp.coordinates || (wp.coordinates as any).length < 2) {
                                     setFocusedWaypointWithoutCoords(wp.id);
                                     onWaitingForCoords(wp.id);
                                   } else if (focusedWaypointWithoutCoords) {
                                     setFocusedWaypointWithoutCoords(null);
                                     onWaitingForCoords(null);
                                   }
                                 }}
                                 onKeyDown={handleTitleKeyDown}
                                 onBlur={(e) => {
                                   if (e.target.value !== wp.name && !(e.target.value === '' && !wp.name)) {
                                     const newSegments = trip.segments.map(s => ({
                                       ...s,
                                       waypoints: s.waypoints.map(w => w.id === wp.id ? { ...w, name: e.target.value } : w)
                                     }));
                                     onUpdateTrip({ ...trip, segments: newSegments });
                                   }
                                 }}
                             />
                             
                             <div className="waypoint-tools">
                               <button 
                                 className="iconButton" 
                                 style={{ padding: '4px' }} 
                                 title={wp.importance === 'hidden' ? 'Make Normal' : 'Make Hidden'}
                                 onClick={() => {
                                   const newImportance: 'normal' | 'hidden' = wp.importance === 'hidden' ? 'normal' : 'hidden';
                                   const newSegments = trip.segments.map(s => ({
                                     ...s,
                                     waypoints: s.waypoints.map(w => w.id === wp.id ? { ...w, importance: newImportance } : w)
                                   }));
                                   onUpdateTrip({ ...trip, segments: newSegments });
                                 }}
                               >
                                 <MaterialIcon name={wp.importance === 'hidden' ? 'visibility_off' : 'visibility'} size={16} />
                               </button>
                               <button className="iconButton" style={{ padding: '4px' }} title="Jump to point" onClick={() => onJumpToWaypoint(wp.id)}><MaterialIcon name="my_location" size={16} /></button>
                                 <button 
                                   className="iconButton" 
                                   style={{ padding: '4px' }} 
                                   title="Split segment"
                                   disabled={wpIndex === 0 || wpIndex === seg.waypoints.length - 1}
                                   onClick={() => handleSplitSegment(segIndex, wpIndex)}
                                 >
                                   <MaterialIcon name="content_cut" size={16} />
                                 </button>
                               <button className="iconButton" style={{ padding: '4px' }} title="Move Earlier" disabled={!canMoveEarlier} onClick={() => handleMoveWaypointEarlier(wp.id)}><MaterialIcon name="arrow_upward" size={16} /></button>
                               <button className="iconButton" style={{ padding: '4px' }} title="Move Later" disabled={!canMoveLater} onClick={() => handleMoveWaypointLater(wp.id)}><MaterialIcon name="arrow_downward" size={16} /></button>
                               <button className="iconButton" style={{ padding: '4px' }} title="Remove waypoint" disabled={!canRemove} onClick={() => handleRemoveWaypoint(wp.id)}><MaterialIcon name="delete" size={16} style={{ color: canRemove ? '#d9534f' : 'inherit' }} /></button>
                               <button className="iconButton" style={{ padding: '4px' }} title="Waypoint Info" onClick={() => onSelectWaypoint(wp.id)}><MaterialIcon name="info" size={16} /></button>
                             </div>
                           </div>
                         </div>

                       </div>
                     );
                   })}
                 </div>
               </div>
             );
             })}
         </div>
      </div>
    </>
  );
}
