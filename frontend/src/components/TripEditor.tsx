import { useEffect, Fragment, useRef, useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { TRANSPORT_MODES, type Trip, type Segment, type Waypoint } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { ModeThemes } from '../themes/config';
import { routingManager } from '../routing/RoutingService';
import { optimizeSegmentRoute } from '../routing/routeOptimizer';
import { Dialog } from './Dialog';
import { exportTripGPX, exportTripGeoJSON, downloadFile } from '../utils/exportUtils';

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
  onSave: () => Promise<void> | void;
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

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'gpx' | 'geojson'>('gpx');
  const [exportIncludeMetadata, setExportIncludeMetadata] = useState(true);
  const [exportMinify, setExportMinify] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);
  const handleSaveWrapper = async () => {
    setIsSaving(true);
    await onSave();
    setIsSaving(false);
  };
  
  const [dragRender, setDragRender] = useState<{
    activeId: string;
    deltaY: number;
    originalGlobalIndex: number;
    currentGlobalIndex: number;
    isReleasing?: boolean;
  } | null>(null);

  const dragContext = useRef<{
    activeId: string;
    startY: number;
    items: { id: string; top: number; height: number; center: number }[];
    pointerId: number;
    scrollContainer: Element;
  } | null>(null);

  useEffect(() => {
    const preventDefault = (e: globalThis.TouchEvent) => {
      if (dragContext.current) e.preventDefault();
    };

    if (dragRender) {
      document.body.style.userSelect = 'none';
      document.body.classList.add('is-dragging');
      document.addEventListener('touchmove', preventDefault, { passive: false });
    } else {
      document.body.style.userSelect = '';
      document.body.classList.remove('is-dragging');
      document.removeEventListener('touchmove', preventDefault);
    }

    return () => {
      document.removeEventListener('touchmove', preventDefault);
    }
  }, [dragRender !== null]);

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
      const el = waypointRefs.current[highlightedWaypointId];
      if (!el) return;

      if (window.innerWidth <= 768) {
        const container = el.closest('.content') || el.closest('.trip-editor');
        if (container) {
          const targetTop = el.offsetTop - (container as HTMLElement).offsetTop;
          container.scrollTo({ top: targetTop - (container.clientHeight / 2), behavior: 'smooth' });
        }
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Add a brief highlight flash
      const highlightTargets = el.querySelectorAll('.timeline-col, .waypoint-col') as NodeListOf<HTMLElement>;
      highlightTargets.forEach(target => {
        target.style.transition = 'background-color 0.5s';
        target.style.backgroundColor = '#e6f2ff';
      });
      
      const input = el.querySelector('.waypoint-title-input') as HTMLInputElement | null;
      if (input && window.innerWidth > 768) {
        input.focus();
      }
      
      setTimeout(() => {
        highlightTargets.forEach(target => {
          target.style.backgroundColor = '';
        });
      }, 1000);
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

  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && dragRender && !dragRender.isReleasing) {
        setDragRender(prev => prev ? { ...prev, deltaY: 0, currentGlobalIndex: prev.originalGlobalIndex, isReleasing: true } : null);
        setTimeout(() => {
          setDragRender(null);
          if (dragContext.current) dragContext.current = null;
        }, 200);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [dragRender]);

  const globalWaypoints = trip.segments.flatMap((seg, i) => 
    seg.waypoints.slice(0, i === trip.segments.length - 1 ? undefined : -1)
  );
  
  const boundaryIds = trip.segments.map(s => s.waypoints[0].id);
  
  const segmentStartGlobalIndices = trip.segments.map((_, i) => {
    let sum = 0;
    for (let j = 0; j < i; j++) sum += trip.segments[j].waypoints.length - 1;
    return sum;
  });

  const handlePointerDown = (e: React.PointerEvent, wpId: string, globalIndex: number) => {
    if (e.button !== 0) return; // Only left click
    
    // Require drag targeting cleanly. E.g. touch only timeline-col or drag-handle.
    const HTMLElementTarget = e.target as HTMLElement;
    if (HTMLElementTarget.closest('button, input, textarea')) return;
    if (!HTMLElementTarget.closest('.timeline-col') && !HTMLElementTarget.closest('.drag-handle')) {
      return;
    }

    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    // Measure all rows for collision detection
    const scrollContainer = target.closest('.content') || document.documentElement;
    const currentScroll = scrollContainer.scrollTop;

    const items = Array.from(scrollContainer.querySelectorAll('.waypoint-row-tr')).map(row => {
      const el = row as HTMLElement;
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-wpid')!,
        top: rect.top + currentScroll,
        height: rect.height,
        center: rect.top + rect.height / 2 + currentScroll
      };
    }).filter(item => item.id);

    dragContext.current = {
      activeId: wpId,
      startY: e.clientY + currentScroll,
      items,
      pointerId: e.pointerId,
      scrollContainer
    };
    document.body.classList.add('is-dragging');

    setDragRender({
      activeId: wpId,
      deltaY: 0,
      originalGlobalIndex: globalIndex,
      currentGlobalIndex: globalIndex
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragContext.current || !dragRender) return;
    
    const { startY, items, activeId, scrollContainer } = dragContext.current;
    
    const containerRect = scrollContainer.getBoundingClientRect();

    // Auto-scroll vertically if near window or container edges
    const SCROLL_MARGIN = 60;
    const SCROLL_SPEED = 15;
    if (e.clientY < containerRect.top + SCROLL_MARGIN) {
      scrollContainer.scrollBy({ top: -SCROLL_SPEED, behavior: 'instant' });
    } else if (e.clientY > Math.min(window.innerHeight, containerRect.bottom) - SCROLL_MARGIN) {
      scrollContainer.scrollBy({ top: SCROLL_SPEED, behavior: 'instant' });
    }

    const currentScroll = scrollContainer.scrollTop;
    const currentAbsoluteY = e.clientY + currentScroll;

    let deltaY = currentAbsoluteY - startY;

    const origItem = items.find(i => i.id === activeId);
    if (!origItem || items.length === 0) return;

    // Prevent dragging above the first waypoint or below the last waypoint
    const minTarget = items[0].top;
    const maxTarget = items[items.length - 1].top + items[items.length - 1].height;

    if (origItem.top + deltaY < minTarget) {
      deltaY = minTarget - origItem.top;
    } else if (origItem.top + origItem.height + deltaY > maxTarget) {
      deltaY = maxTarget - (origItem.top + origItem.height);
    }

    const currentCenter = origItem.center + deltaY;

    // Find nearest item using target document Y (currentCenter)
    let newCurrentId = activeId;
    let minDiff = Infinity;
    for (const item of items) {
       const diff = Math.abs(currentCenter - item.center);
       if (diff < minDiff) {
         minDiff = diff;
         newCurrentId = item.id;
       }
    }

    const currentGlobalIndex = globalWaypoints.findIndex(w => w.id === newCurrentId);

    setDragRender(prev => prev ? { 
      ...prev, 
      deltaY, 
      currentGlobalIndex: currentGlobalIndex !== -1 ? currentGlobalIndex : prev.currentGlobalIndex 
    } : null);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragContext.current || !dragRender) return;
    try {
      e.currentTarget.releasePointerCapture(dragContext.current.pointerId);
    } catch (err) {}
    
    const { originalGlobalIndex, currentGlobalIndex, activeId } = dragRender;
    const items = dragContext.current.items;
    
    // Prevent border dragging anomalies
    const targetId = globalWaypoints[currentGlobalIndex]?.id;
    const isBoundaryDrag = targetId && boundaryIds.includes(activeId) && boundaryIds.includes(targetId) && activeId !== targetId;
    
    if (originalGlobalIndex !== currentGlobalIndex && !isBoundaryDrag) {
      let targetDeltaY = 0;
      if (items && items.length > 0) {
        targetDeltaY = items[currentGlobalIndex].top - items[originalGlobalIndex].top;
      }
      
      setDragRender(prev => prev ? { ...prev, deltaY: targetDeltaY, isReleasing: true } : null);
      
      setTimeout(() => {
        const newGlobal = [...globalWaypoints];
        const [dragged] = newGlobal.splice(originalGlobalIndex, 1);
        newGlobal.splice(currentGlobalIndex, 0, dragged);
        
        dragContext.current = null;
        applyGlobalWaypoints(newGlobal).finally(() => {
          setDragRender(null);
        });
      }, 200);
    } else {
      setDragRender(prev => prev ? { ...prev, deltaY: 0, isReleasing: true } : null);
      
      setTimeout(() => {
        setDragRender(null);
        dragContext.current = null;
      }, 200);
    }
  };

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
        if (window.innerWidth <= 768) {
          const container = el.closest('.content') || el.closest('.trip-editor');
          if (container) {
            const targetTop = el.offsetTop - (container as HTMLElement).offsetTop;
            container.scrollTo({ top: targetTop - (container.clientHeight / 2), behavior: 'smooth' });
          }
        } else {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
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

  const tripSummary = trip.tripDistanceSummary || { totalDistance: 0, distanceByMode: {} };

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack}><MaterialIcon name="arrow_back" size={20} /></button>
        <h2 className="toolbar-title">Edit Trip</h2>
        <div className="toolbar-actions">
           <button className="iconButton" title="Undo" onClick={onUndo} disabled={!canUndo}><MaterialIcon name="undo" size={20} /></button>
           <button className="iconButton" title="Redo" onClick={onRedo} disabled={!canRedo}><MaterialIcon name="redo" size={20} /></button>
           <button className="iconButton" title="Zoom to Trip" onClick={onZoomToTrip}><MaterialIcon name="zoom_out_map" size={20} /></button>
           <button className="iconButton" title="Save" onClick={handleSaveWrapper} disabled={!canSave || isSaving} style={{ color: (canSave && !isSaving) ? '#007bff' : 'inherit' }}><MaterialIcon name={isSaving ? "sync" : "save"} size={20} className={isSaving ? "spinning" : undefined} /></button>
           <button className="iconButton" title="Export Trip" onClick={() => setIsExportDialogOpen(true)}><MaterialIcon name="file_download" size={20} /></button>
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
               onChange={(e) => {
                 onUpdateTrip({ ...trip, startDate: e.target.value });
               }}
             />
           </div>
           <div className="form-col">
             <label className="form-label">End Date</label>
             <input 
               type="date" 
               className="form-input"
               defaultValue={trip.endDate ? trip.endDate.split('T')[0] : ''}
               onChange={(e) => {
                 onUpdateTrip({ ...trip, endDate: e.target.value });
               }}
             />
           </div>
         </div>
         
         <table className="trip-table">
           <tbody>
             {trip.segments.length > 0 && trip.segments[0].waypoints.length > 0 && (
               <tr className="gap-row">
                 <td className="segment-col"></td>
                 <td className="timeline-col gap-col">
                   <div className="timeline-line bottom" style={{ background: trip.segments[0].customColor || ModeThemes[trip.segments[0].transportMode]?.color || '#007bff' }}></div>
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
               
               const currSegColor = seg.customColor || ModeThemes[seg.transportMode]?.color || '#007bff';

               return renderedWaypoints.map((wp, wpIndex) => {
                 const isFirstInSeg = wpIndex === 0;

                 const isLastInSegRender = wpIndex === renderedWaypoints.length - 1;
                 const isLastOfTrip = isLastSegment && isLastInSegRender;

                 const prevSegColor = segIndex > 0 ? (trip.segments[segIndex - 1].customColor || ModeThemes[trip.segments[segIndex - 1].transportMode]?.color || '#007bff') : currSegColor;
                 const topLineColor = (isFirstInSeg && segIndex > 0) ? prevSegColor : currSegColor;
                 const bottomLineColor = currSegColor;

                 const globalIndex = baseGlobalIndex + wpIndex;
                 const canMoveEarlier = globalIndex > 0 && !(boundaryIds.includes(wp.id) && boundaryIds.includes(globalWaypoints[globalIndex - 1]?.id));
                 const canMoveLater = globalIndex >= 0 && globalIndex < globalWaypoints.length - 1 && !(boundaryIds.includes(wp.id) && boundaryIds.includes(globalWaypoints[globalIndex + 1]?.id));
                 const canRemove = !(isFirstInSeg && boundaryIds.includes(globalWaypoints[globalIndex + 1]?.id)) && !(isLastOfTrip && isFirstInSeg);

                 const distanceStats = seg.waypointDistances?.[wpIndex] || null;

                 let translateY = 0;
                 let isDragged = false;
                 let targetDotColor = '';
                 
                 if (dragRender) {
                   if (dragRender.activeId === wp.id) {
                     isDragged = true;
                     translateY = dragRender.deltaY;
                     
                     const { originalGlobalIndex, currentGlobalIndex } = dragRender;
                     const newGlobal = [...globalWaypoints];
                     const [draggedItem] = newGlobal.splice(originalGlobalIndex, 1);
                     newGlobal.splice(currentGlobalIndex, 0, draggedItem);
                     
                     let foundSegIndex = 0;
                     for (let i = currentGlobalIndex; i >= 0; i--) {
                       if (boundaryIds.includes(newGlobal[i].id)) {
                         foundSegIndex = Math.min(boundaryIds.indexOf(newGlobal[i].id), trip.segments.length - 1);
                         break;
                       }
                     }
                     targetDotColor = trip.segments[foundSegIndex]?.customColor || ModeThemes[trip.segments[foundSegIndex]?.transportMode]?.color || currSegColor;
                   } else {
                     const { originalGlobalIndex, currentGlobalIndex } = dragRender;
                     const isMovingUp = currentGlobalIndex < originalGlobalIndex;
                     const items = dragContext.current?.items;
                     
                     if (items && items.length > 1) {
                       const sizeRef = originalGlobalIndex < items.length - 1 ? 
                         items[originalGlobalIndex + 1].top - items[originalGlobalIndex].top : 
                         items[originalGlobalIndex].top - items[originalGlobalIndex - 1].top;
                         
                       if (isMovingUp && globalIndex >= currentGlobalIndex && globalIndex < originalGlobalIndex) {
                         translateY = sizeRef;
                       } else if (!isMovingUp && globalIndex <= currentGlobalIndex && globalIndex > originalGlobalIndex) {
                         translateY = -sizeRef;
                       }
                     }
                   }
                 }
                 
                 const isReleasing = dragRender?.isReleasing;
                 
                 const transitionStyle = (dragRender && !isDragged) || (isDragged && isReleasing) 
                   ? 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)' 
                   : 'none';

                 const transformStyle: React.CSSProperties = {
                   transform: `translateY(${translateY}px)`,
                   transition: transitionStyle,
                   zIndex: isDragged ? 100 : 1,
                   position: 'relative'
                 };
                 
                 const dotTransformStyle: React.CSSProperties = {
                   transform: `translate(-50%, calc(-50% + ${translateY}px))`,
                   transition: transitionStyle,
                   zIndex: isDragged ? 100 : 2,
                 };

                 return (
                   <Fragment key={`${seg.id}-${wp.id}`}>
                     <tr 
                      className={`waypoint-row-tr ${isDragged ? 'dragged' : ''}`}
                      ref={(el) => { waypointRefs.current[wp.id] = el; }}
                      data-wpid={wp.id}
                      onPointerDown={(e) => handlePointerDown(e, wp.id, globalIndex)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                     >
                       {isFirstInSeg ? (
                        <td className="segment-col" rowSpan={Math.max(1, (seg.waypoints.length - 1) * 2)} onPointerDown={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
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
                               {seg.customIcon ? <MaterialIcon name={seg.customIcon} size={18} /> : getModeIcon(seg.transportMode, 18)}
                               </button>
                               <button 
                                 className="iconButton small" 
                                 title={seg.isHidden ? "Show Segment" : "Hide Segment"} 
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   const newSegments = trip.segments.map(s => 
                                     s.id === seg.id ? { ...s, isHidden: !s.isHidden } : s
                                   );
                                   onUpdateTrip({ ...trip, segments: newSegments });
                                 }}>
                                 <MaterialIcon name={seg.isHidden ? "visibility_off" : "visibility"} size={18} style={{ color: seg.isHidden ? '#999' : 'inherit' }} />
                               </button>
                               <button className="iconButton small" title="Segment Info" onClick={() => onSelectSegment(seg.id)}>
                                 <MaterialIcon name="info" size={18} />
                               </button>
                             </div>
                             <div className="segment-tools-grid">
                               <button className="iconButton small" title="Start earlier" disabled={segIndex === 0 || trip.segments[segIndex - 1].waypoints.length <= 2} onClick={() => handleStartEarlier(segIndex)}>
                                 <MaterialIcon name="arrow_upward" size={18} />
                               </button>
                               <button className="iconButton small" title="Start later" disabled={segIndex === 0 || seg.waypoints.length <= 2} onClick={() => handleStartLater(segIndex)}>
                                 <MaterialIcon name="arrow_downward" size={18} />
                               </button>
                               <button className="iconButton small" title="Delete segment" disabled={segIndex === 0} onClick={() => handleDeleteSegment(segIndex)}>
                                 <MaterialIcon name="delete" size={18} style={{ color: segIndex === 0 ? 'inherit' : '#d9534f' }} />
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
                           ...dotTransformStyle,
                           width: wp.icon ? '24px' : undefined,
                           height: wp.icon ? '24px' : undefined,
                           background: isDragged ? targetDotColor : ((isFirstInSeg && segIndex > 0) ? `linear-gradient(to bottom, ${prevSegColor} 50%, ${currSegColor} 50%)` : currSegColor), 
                           border: isDragged ? `3px solid white` : 'none',
                           boxShadow: isDragged ? `0 0 0 2px ${targetDotColor}` : 'none',
                           cursor: isDragged ? 'grabbing' : 'grab',
                           color: 'white'
                         }}>
                           {wp.icon && <MaterialIcon name={wp.icon} size={16} />}
                         </div>
                       </td>
                       <td className="waypoint-col">
                         <div className="waypoint-card" style={{ ...transformStyle, position: 'relative' }}>
                           <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                             <input
                               key={`wpt-${wp.id}-${wp.name}`}
                               type="text"
                               defaultValue={wp.name || ''}
                               placeholder={(!wp.coordinates || (wp.coordinates as any).length < 2) ? (focusedWaypointWithoutCoords === wp.id ? "Select on map or type to search" : "Focus to set coordinates") : `${wp.coordinates[1].toFixed(5)}, ${wp.coordinates[0].toFixed(5)}`}
                               className="waypoint-title-input"
                               style={{ flex: 1 }}
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
                             <div className="drag-handle" style={{ cursor: isDragged ? 'grabbing' : 'grab', padding: '0 8px', color: '#ccc', display: 'flex', alignItems: 'center' }}>
                               <MaterialIcon name="drag_indicator" size={20} />
                             </div>
                             {wpSearchState?.wpId === wp.id && (wpSearchResults.length > 0 || isWpSearching) && (
                               <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: 'white', border: '1px solid #ddd', borderRadius: '4px', maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                                 {isWpSearching && <div style={{ padding: '8px', fontSize: '0.85rem', color: '#666' }}>Searching...</div>}
                                 {!isWpSearching && wpSearchResults.map(res => (
                                   <div key={res.place_id} style={{ padding: '8px', fontSize: '0.85rem', borderBottom: '1px solid #eee', cursor: 'pointer' }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9f9f9'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                                        onMouseDown={(e) => {
                                            e.preventDefault(); 
                                            const newSegments = trip.segments.map(s => ({
                                              ...s,
                                              waypoints: s.waypoints.map(w => w.id === wp.id ? { 
                                                ...w, 
                                                name: res.name || res.display_name.split(',')[0], 
                                                coordinates: [parseFloat(res.lon), parseFloat(res.lat)] as [number, number],
                                                poi: {
                                                  id: res.osm_id ? `search-${res.osm_type}-${res.osm_id}` : res.place_id,
                                                  name: res.name || res.display_name.split(',')[0],
                                                  type: res.class,
                                                  details: { subclass: res.type }
                                                }
                                              } : w)
                                            }));
                                            setWpSearchState(null);
                                            onUpdateTrip({ ...trip, segments: newSegments });
                                            setTimeout(() => {
                                              onJumpToWaypoint(wp.id);
                                            }, 50);
                                        }}>
                                     <strong>{res.name || res.display_name.split(',')[0]}</strong>
                                     <div style={{ fontSize: '0.75rem', color: '#666' }}>{res.display_name}</div>
                                   </div>
                                 ))}
                               </div>
                             )}
                           </div>
                           <div className="waypoint-tools">
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
                           <div className="distance-content" style={{ visibility: dragRender ? 'hidden' : 'visible' }}>
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

      <Dialog
        isOpen={isExportDialogOpen}
        title="Export Trip"
        onClose={() => setIsExportDialogOpen(false)}
        actions={
          <>
            <button className="dialog-btn dialog-btn-cancel" onClick={() => setIsExportDialogOpen(false)}>Cancel</button>
            <button className="dialog-btn dialog-btn-primary" onClick={() => {
              const content = exportFormat === 'gpx' 
                ? exportTripGPX(trip, exportIncludeMetadata) 
                : exportTripGeoJSON(trip, exportIncludeMetadata, exportMinify);
              const filename = `${trip.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'trip'}.${exportFormat}`;
              const mimeType = exportFormat === 'gpx' ? 'application/gpx+xml' : 'application/geo+json';
              downloadFile(content, filename, mimeType);
              setIsExportDialogOpen(false);
            }}>Export</button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>Format</label>
            <div style={{ display: 'flex', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="exportFormat" 
                  value="gpx" 
                  checked={exportFormat === 'gpx'} 
                  onChange={() => setExportFormat('gpx')} 
                /> GPX
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="exportFormat" 
                  value="geojson" 
                  checked={exportFormat === 'geojson'} 
                  onChange={() => setExportFormat('geojson')} 
                /> GeoJSON
              </label>
            </div>
            {exportFormat === 'geojson' && (
              <div style={{ marginTop: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input 
                    type="checkbox" 
                    checked={exportMinify} 
                    onChange={(e) => setExportMinify(e.target.checked)} 
                  />
                  <span>Minify output (no pretty printing)</span>
                </label>
              </div>
            )}
          </div>
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={exportIncludeMetadata} 
                onChange={(e) => setExportIncludeMetadata(e.target.checked)} 
              />
              <span>Include Application Metadata</span>
            </label>
            <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '4px', marginLeft: '24px' }}>
              Includes Triplo-specific data like colors, custom icons, and other rich information.
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
