import { useEffect, Fragment, useRef, useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { TRANSPORT_MODES, type Trip, type Segment, type Waypoint } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';
import { routingManager } from '../routing/RoutingService';
import { optimizeSegmentRoute } from '../routing/routeOptimizer';
import { getDistanceStats, getTripDistanceSummary } from '../utils/distance';

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
  const [wpSearchState, setWpSearchState] = useState<{ wpId: string, query: string } | null>(null);
  const [wpSearchResults, setWpSearchResults] = useState<any[]>([]);
  const [isWpSearching, setIsWpSearching] = useState(false);

  useEffect(() => {
    if (!wpSearchState) {
      setWpSearchResults([]);
      return;
    }
    const { query } = wpSearchState;
    if (!query.trim()) {
      setWpSearchResults([]);
      return;
    }
    const timerId = setTimeout(async () => {
      setIsWpSearching(true);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setWpSearchResults(data);
      } catch (err) {
        console.error('Error fetching results', err);
      } finally {
        setIsWpSearching(false);
      }
    }, 1000);
    return () => clearTimeout(timerId);
  }, [wpSearchState]);

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

  const updateSegmentRoute = async (segment: Segment, oldSegState?: Segment): Promise<Segment> => {
    if (segment.source === 'router') {
        const oldSegment = oldSegState || trip.segments.find(s => s.id === segment.id);
        const geometry = await optimizeSegmentRoute(segment, oldSegment);
        if (!geometry) return { ...segment, geometry: undefined as any };
        return { ...segment, geometry };
      }
      if (segment.waypoints.length < 2) {
          return { ...segment, geometry: undefined as any };
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

  const tripSummary = getTripDistanceSummary(trip);

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack}><MaterialIcon name="arrow_back" size={20} /></button>
        <h2 className="toolbar-title">Edit Trip</h2>
        <div className="toolbar-actions">
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
         
         <table className="trip-table">
           <tbody>
             {trip.segments.length > 0 && trip.segments[0].waypoints.length > 0 && (
               <tr className="gap-row">
                 <td className="segment-col"></td>
                 <td className="timeline-col gap-col">
                   <div className="timeline-line bottom" style={{ background: ModeThemes[trip.segments[0].transportMode]?.color || '#007bff' }}></div>
                   <div 
                     className="timeline-plus" 
                     title="Add Waypoint Here"
                     onClick={() => handleInsertWaypoint(trip.segments[0].waypoints[0].id, 'before')}
                   >
                     <MaterialIcon name="add" size={14} style={{ color: '#666' }} />
                   </div>
                 </td>
                 <td className="waypoint-col gap-col"></td>
               </tr>
             )}

             {trip.segments.map((seg, segIndex) => {
               const baseGlobalIndex = segmentStartGlobalIndices[segIndex];
               const isLastSegment = segIndex === trip.segments.length - 1;
               const renderedWaypoints = isLastSegment ? seg.waypoints : seg.waypoints.slice(0, -1);
               
               const currSegColor = ModeThemes[seg.transportMode]?.color || '#007bff';

               return renderedWaypoints.map((wp, wpIndex) => {
                 const isFirstInSeg = wpIndex === 0;

                 const isLastInSegRender = wpIndex === renderedWaypoints.length - 1;
                 const isLastOfTrip = isLastSegment && isLastInSegRender;

                 const prevSegColor = segIndex > 0 ? (ModeThemes[trip.segments[segIndex - 1].transportMode]?.color || '#007bff') : currSegColor;
                 const topLineColor = (isFirstInSeg && segIndex > 0) ? prevSegColor : currSegColor;
                 const bottomLineColor = currSegColor;

                 const globalIndex = baseGlobalIndex + wpIndex;
                 const canMoveEarlier = globalIndex > 0 && !(boundaryIds.includes(wp.id) && boundaryIds.includes(globalWaypoints[globalIndex - 1]?.id));
                 const canMoveLater = globalIndex >= 0 && globalIndex < globalWaypoints.length - 1 && !(boundaryIds.includes(wp.id) && boundaryIds.includes(globalWaypoints[globalIndex + 1]?.id));
                 const canRemove = !(isFirstInSeg && boundaryIds.includes(globalWaypoints[globalIndex + 1]?.id)) && !(isLastOfTrip && isFirstInSeg);

                 const hasValidCoords = (w?: Waypoint) => w && w.coordinates && (w.coordinates as any).length >= 2;
                 const distanceStats = (wpIndex < seg.waypoints.length - 1 && hasValidCoords(wp) && hasValidCoords(seg.waypoints[wpIndex + 1]))
                   ? getDistanceStats(wp, seg.waypoints[wpIndex + 1], seg.geometry as any)
                    : null;

                 return (
                   <Fragment key={`${seg.id}-${wp.id}`}>
                     <tr className={`waypoint-row-tr ${highlightedWaypointId === wp.id ? 'selected' : ''}`} ref={(el) => { waypointRefs.current[wp.id] = el; }}>
                       {isFirstInSeg ? (
                        <td className="segment-col" rowSpan={Math.max(1, (seg.waypoints.length - 1) * 2)}>
                           <div className="segment-toolbox">
                             <textarea 
                               className="segment-title-textarea"
                               defaultValue={seg.name || seg.transportMode}
                               onKeyDown={handleSegmentTitleKeyDown}
                               onBlur={(e) => {
                                 if (e.target.value !== (seg.name || seg.transportMode) && e.target.value !== seg.name) {
                                   const newSegments = [...trip.segments];
                                   newSegments[segIndex] = { ...seg, name: e.target.value };
                                   onUpdateTrip({ ...trip, segments: newSegments });
                                 }
                               }}
                             />
                             <div className="segment-tools-row">
                               <button 
                                 className="iconButton small" 
                                 style={{ color: currSegColor }} 
                                 title={`Switch mode: ${seg.transportMode}`}
                                 onClick={async () => {
                                   const currentIndex = TRANSPORT_MODES.indexOf(seg.transportMode);
                                   const nextMode = TRANSPORT_MODES[(currentIndex + 1) % TRANSPORT_MODES.length];
                                   const newSegments = [...trip.segments];
                                   const defRouter = routingManager.getDefaultRouter(nextMode as any);
                                   newSegments[segIndex] = await updateSegmentRoute({ 
                                     ...seg, 
                                     transportMode: nextMode as any,
                                     routingService: defRouter.serviceName,
                                     routingProfile: defRouter.profile
                                   });
                                   onUpdateTrip({ ...trip, segments: newSegments });
                                 }}
                               >
                                 {getModeIcon(seg.transportMode, 18)}
                               </button>
                               <button className="iconButton small" title="Segment Info" onClick={() => onSelectSegment(seg.id)}>
                                 <MaterialIcon name="info" size={18} />
                               </button>
                             </div>
                             <div className="segment-tools-grid">
                               <button className="iconButton small" title="Start earlier" disabled={segIndex === 0 || trip.segments[segIndex - 1].waypoints.length <= 2} onClick={() => handleStartEarlier(segIndex)}>
                                 <MaterialIcon name="arrow_upward" size={16} />
                               </button>
                               <button className="iconButton small" title="Start later" disabled={segIndex === 0 || seg.waypoints.length <= 2} onClick={() => handleStartLater(segIndex)}>
                                 <MaterialIcon name="arrow_downward" size={16} />
                               </button>
                               <button className="iconButton small" title="Delete segment" disabled={segIndex === 0} onClick={() => handleDeleteSegment(segIndex)}>
                                 <MaterialIcon name="delete" size={16} style={{ color: segIndex === 0 ? 'inherit' : '#d9534f' }} />
                               </button>
                             </div>
                           </div>
                         </td>
                       ) : (
                         isLastOfTrip && <td className="segment-col"></td>
                       )}
                       <td className="timeline-col">
                         <div className="timeline-line top" style={{ background: topLineColor }}></div>
                         <div className="timeline-line bottom" style={{ background: bottomLineColor }}></div>
                         <div className="timeline-dot" style={{ 
                           background: wp.importance === 'hidden' ? 'white' : ((isFirstInSeg && segIndex > 0) ? `linear-gradient(to bottom, ${prevSegColor} 50%, ${currSegColor} 50%)` : currSegColor), 
                           border: wp.importance === 'hidden' ? `3px solid ${currSegColor}` : 'none'
                         }}></div>
                       </td>
                       <td className="waypoint-col">
                         <div className="waypoint-card">
                           <div style={{ position: 'relative' }}>
                             <input
                               key={`wpt-${wp.id}-${wp.name}`}
                               type="text"
                               defaultValue={wp.name || ''}
                               placeholder={(!wp.coordinates || (wp.coordinates as any).length < 2) ? (focusedWaypointWithoutCoords === wp.id ? "Select on map or type to search" : "Focus to set coordinates") : `${wp.coordinates[1].toFixed(5)}, ${wp.coordinates[0].toFixed(5)}`}
                               className="waypoint-title-input"
                               data-wpid={wp.id}
                               onChange={(e) => {
                                 if (!wp.coordinates || (wp.coordinates as any).length < 2) {
                                   setWpSearchState({ wpId: wp.id, query: e.target.value });
                                 }
                               }}
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
                                 setTimeout(() => {
                                   if (wpSearchState?.wpId === wp.id) {
                                     setWpSearchState(null);
                                   }
                                 }, 200);
                                 if (e.target.value !== wp.name && !(e.target.value === '' && !wp.name)) {
                                   const newSegments = trip.segments.map(s => ({
                                     ...s,
                                     waypoints: s.waypoints.map(w => w.id === wp.id ? { ...w, name: e.target.value } : w)
                                   }));
                                   onUpdateTrip({ ...trip, segments: newSegments });
                                 }
                               }}
                             />
                             {wpSearchState?.wpId === wp.id && (wpSearchResults.length > 0 || isWpSearching) && (
                               <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'white', border: '1px solid #ddd', borderRadius: '4px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                                 {isWpSearching && <div style={{ padding: '8px', fontSize: '0.85rem', color: '#666' }}>Searching...</div>}
                                 {!isWpSearching && wpSearchResults.map(res => (
                                   <div key={res.place_id} style={{ padding: '8px', fontSize: '0.85rem', borderBottom: '1px solid #eee', cursor: 'pointer' }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9f9f9'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                                        onClick={() => {
                                            const newSegments = trip.segments.map(s => ({
                                              ...s,
                                              waypoints: s.waypoints.map(w => w.id === wp.id ? { ...w, name: res.name || res.display_name.split(',')[0], coordinates: [parseFloat(res.lon), parseFloat(res.lat)] as [number, number] } : w)
                                            }));
                                            setWpSearchState(null);
                                            onUpdateTrip({ ...trip, segments: newSegments });
                                        }}>
                                     <strong>{res.name || res.display_name.split(',')[0]}</strong>
                                     <div style={{ fontSize: '0.75rem', color: '#666' }}>{res.display_name}</div>
                                   </div>
                                 ))}
                               </div>
                             )}
                           </div>
                           <div className="waypoint-tools">
                             <button className="iconButton small" title={wp.importance === 'hidden' ? 'Make Normal' : 'Make Hidden'} onClick={() => {
                               const newImportance: 'normal' | 'hidden' = wp.importance === 'hidden' ? 'normal' : 'hidden';
                               const newSegments = trip.segments.map(s => ({ ...s, waypoints: s.waypoints.map(w => w.id === wp.id ? { ...w, importance: newImportance } : w) }));
                               onUpdateTrip({ ...trip, segments: newSegments });
                             }}>
                               <MaterialIcon name={wp.importance === 'hidden' ? 'visibility_off' : 'visibility'} size={16} />
                             </button>
                             <button className="iconButton small" title="Jump to point" onClick={() => onJumpToWaypoint(wp.id)}><MaterialIcon name="my_location" size={16} /></button>
                             <button className="iconButton small" title="Split segment" disabled={wpIndex === 0 || wpIndex === seg.waypoints.length - 1} onClick={() => handleSplitSegment(segIndex, wpIndex)}><MaterialIcon name="content_cut" size={16} /></button>
                             <button className="iconButton small" title="Move Earlier" disabled={!canMoveEarlier} onClick={() => handleMoveWaypointEarlier(wp.id)}><MaterialIcon name="arrow_upward" size={16} /></button>
                             <button className="iconButton small" title="Move Later" disabled={!canMoveLater} onClick={() => handleMoveWaypointLater(wp.id)}><MaterialIcon name="arrow_downward" size={16} /></button>
                             <button className="iconButton small" title="Remove waypoint" disabled={!canRemove} onClick={() => handleRemoveWaypoint(wp.id)}><MaterialIcon name="delete" size={16} style={{ color: canRemove ? '#d9534f' : 'inherit' }} /></button>
                             <button className="iconButton small" title="Waypoint Info" onClick={() => onSelectWaypoint(wp.id)}><MaterialIcon name="info" size={16} /></button>
                           </div>
                         </div>
                       </td>
                     </tr>
                     <tr className="gap-row">
                       {isLastOfTrip && <td className="segment-col"></td>}
                       <td className="timeline-col gap-col">
                         <div className={`timeline-line ${isLastOfTrip ? 'top' : 'full'}`} style={{ background: bottomLineColor }}></div>
                           <div 
                             className="timeline-plus" 
                             title="Add Waypoint Here"
                             onClick={() => handleInsertWaypoint(wp.id, 'after')}
                           >
                             <MaterialIcon name="add" size={14} style={{ color: '#666' }} />
                           </div>
                       </td>
                       <td className="waypoint-col gap-col">
                         {!isLastOfTrip && distanceStats ? (
                           <div className="distance-content">
                             <span className="distance-stat"><MaterialIcon name="straighten" size={14} /> {(distanceStats.distanceKm).toFixed(1)} km</span>
                             {distanceStats.hasElevation && (
                               <>
                                 {Math.round(distanceStats.elevationUp) > 0 && <span className="distance-stat"><MaterialIcon name="trending_up" size={14} /> {Math.round(distanceStats.elevationUp)} m</span>}
                                 {Math.round(distanceStats.elevationDown) > 0 && <span className="distance-stat"><MaterialIcon name="trending_down" size={14} /> {Math.round(distanceStats.elevationDown)} m</span>}
                               </>
                             )}
                           </div>
                         ) : null}
                       </td>
                     </tr>
                   </Fragment>
                 );
               });
             })}
           </tbody>
         </table>
         <div className="trip-summary">
           <h3 className="trip-summary-title">
             <MaterialIcon name="analytics" size={18} /> Trip Summary
           </h3>
           <div className="trip-summary-total">
             <strong>Total Distance:</strong> {tripSummary.totalDistance.toFixed(1)} km
           </div>
           
           {Object.keys(tripSummary.distanceByMode).length > 0 && (
             <table className="trip-summary-table">
               <thead>
                 <tr style={{ borderBottom: '1px solid #dee2e6', textAlign: 'left' }}>
                   <th style={{ padding: '4px 8px 4px 0' }}>Mode</th>
                   <th style={{ padding: '4px 0', textAlign: 'right' }}>Distance (km)</th>
                 </tr>
               </thead>
               <tbody>
                 {Object.entries(tripSummary.distanceByMode)
                   .sort(([, a], [, b]) => b - a)
                   .map(([mode, dist]) => (
                   <tr key={mode} className="trip-summary-row">
                     <td className="trip-summary-td">
                       <span style={{ color: ModeThemes[mode as keyof typeof ModeThemes]?.color || '#666' }}>
                         {getModeIcon(mode as any, 16)}
                       </span>
                       {mode.replace('_', ' ')}
                     </td>
                     <td className="trip-summary-td right">
                       {(dist as number).toFixed(1)}
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           )}
         </div>
      </div>
    </>
  );
}
