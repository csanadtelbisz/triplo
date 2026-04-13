import { useState, useEffect, useRef } from 'react';
import './styles/App.css';
import './styles/Shared.css';
import './styles/TripManager.css';
import './styles/TripEditor.css';
import './styles/WaypointInfo.css';
import './styles/StatusPanel.css';
import type { Trip } from '../../shared/types';
import { TripAPI } from './api/client';
// Imports removed or used
import { optimizeSegmentRoute } from './routing/routeOptimizer';
import { computeTripCaches } from './utils/distance';
import { slugify } from './utils/slugify';

import { TripManager } from './components/TripManager';
import { TripEditor } from './components/TripEditor';
import { SegmentInfo } from './components/SegmentInfo';
import { WaypointInfo } from './components/WaypointInfo';
import { POIInfo } from './components/POIInfo';
import { SearchPanel } from './components/SearchPanel';
import { Dialog } from './components/Dialog';
import { StatusPanel } from './components/StatusPanel';
import { persistingManager } from './persisting/PersistingManager';
import { Map } from './components/Map';
import type { MapRef } from './components/Map';

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [histories, setHistories] = useState<Record<string, { past: Trip[], future: Trip[], lastSavedStr: string }>>({});
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [tripConflicts, setTripConflicts] = useState<Record<string, Trip[]>>({});
  const conflictedTripIds = new Set(Object.keys(tripConflicts));
  const [resolvingTripId, setResolvingTripId] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [selectedPOI, setSelectedPOI] = useState<any | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [highlightedWaypointId, setHighlightedWaypointId] = useState<string | null>(null);
  const [hoveredCoordinate, setHoveredCoordinate] = useState<{ lon: number; lat: number; ele?: number } | null>(null);
  const [waitingWaypointId, setWaitingWaypointId] = useState<string | null>(null);
  const waitingWaypointIdRef = useRef<string | null>(null);

  const stripMeta = (t: Trip) => {
    const copy: any = { ...t };
    delete copy.metadata;
    return JSON.stringify(copy);
  };

  const loadTrips = async () => {
    try {
      const apiTrips = await TripAPI.getTrips();
      const remoteTrips = await persistingManager.loadAllTrips();

      const variantsByTripId: Record<string, Trip[]> = {};
      const conflictsFound: Record<string, Trip[]> = {};

      apiTrips.forEach(t => {
        t.metadata = t.metadata || {};
        t.metadata._sourceService = 'Local Browser Storage';
        variantsByTripId[t.id] = [t];
      });

      remoteTrips.forEach((t: Trip) => {
        if (!variantsByTripId[t.id]) variantsByTripId[t.id] = [];
        variantsByTripId[t.id].push(t);
      });

      const tripsMap = new globalThis.Map<string, Trip>();

      Object.entries(variantsByTripId).forEach(([id, variants]) => {
        // Find remote variants
        const remoteVariants = variants.filter(v => v.metadata?._sourceService && v.metadata._sourceService !== 'Local Browser Storage');
        
        // Count unique remote contents ignoring metadata
        const uniqueRemoteContents = new Set(remoteVariants.map(v => stripMeta(v)));

        // Only conflict if there are MULTIPLE distinct remote versions that disagree
        if (uniqueRemoteContents.size > 1) {
          // It's a conflict!
          const groupedVariants: Trip[] = [];
          variants.forEach(variant => {
            const existing = groupedVariants.find(t => stripMeta(t) === stripMeta(variant));
            if (existing) {
              const existingSources = new Set((existing.metadata?._sourceService || '').split(', '));
              if (variant.metadata?._sourceService) existingSources.add(variant.metadata._sourceService);
              existing.metadata = existing.metadata || {};
              existing.metadata._sourceService = Array.from(existingSources).filter(Boolean).join(', ');
            } else {
              groupedVariants.push({ ...variant, metadata: { ...variant.metadata, _sourceService: variant.metadata?._sourceService } });
            }
          });
          conflictsFound[id] = groupedVariants;

          // Use the newest one tentatively in the map so it renders
          const newest = [...variants].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
          tripsMap.set(id, newest);
        } else {
          // No conflict between persisting services
          // Auto-resolve by taking the absolute newest one (even if it's local)
          const newest = { ...[...variants].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] };
          
          // Merge metadata
          const allSyncedServices = new Set<string>();
          variants.forEach(v => {
            if (v.metadata?._sourceService && v.metadata._sourceService !== 'Local Browser Storage') {
              allSyncedServices.add(v.metadata._sourceService);
            }
            (v.metadata?.syncedServices || []).forEach((s: string) => allSyncedServices.add(s));
          });

          newest.metadata = newest.metadata || {};
          newest.metadata.syncedServices = Array.from(allSyncedServices);
          // Keep Local Browser Storage as the active working source tag
          newest.metadata._sourceService = 'Local Browser Storage';

          tripsMap.set(id, newest);
        }
      });

      setTripConflicts(conflictsFound);

      const fetchedTrips = Array.from(tripsMap.values());
      const cachedTrips = fetchedTrips.map(computeTripCaches);
      setTrips(cachedTrips);
      const initHistories: Record<string, { past: Trip[], future: Trip[], lastSavedStr: string }> = {};
      cachedTrips.forEach(t => {
        initHistories[t.id] = { past: [], future: [], lastSavedStr: stripMeta(t) };
      });
      setHistories(initHistories);
    } catch (e) {
      console.error(e);
    }
  };

  const updateTripState = (tripId: string, newTrip: Trip, replaceLastHistory: boolean = false) => {
    const cachedTrip = computeTripCaches(newTrip);
    setTrips(prev => prev.map(t => t.id === tripId ? cachedTrip : t));

    setHistories(prev => {
      const h = prev[tripId] || { past: [], future: [], lastSavedStr: '' };
      const currentTrip = trips.find(t => t.id === tripId) || cachedTrip;
      return {
        ...prev,
        [tripId]: {
          past: replaceLastHistory ? h.past : [...h.past, currentTrip],
          future: [],
          lastSavedStr: h.lastSavedStr
        }
      };
    });
    
    if (selectedTrip?.id === tripId) {
      setSelectedTrip(cachedTrip);
    }
  };

  const handleCoordinateChange = async (trip: Trip, wpId: string, coords: [number, number]) => {
    const newSegments = [...trip.segments];
    let changed = false;

    for (let i = 0; i < newSegments.length; i++) {
      const seg = { ...newSegments[i] };
      const wpIdx = seg.waypoints.findIndex(w => w.id === wpId);
      if (wpIdx > -1) {
        seg.waypoints = seg.waypoints.map(w => w.id === wpId ? { ...w, coordinates: coords } : w);
        
        if (seg.source === 'router') {
            const validCoords = seg.waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map(w => w.coordinates);
            if (validCoords.length >= 2) {
               seg.geometry = await optimizeSegmentRoute(seg, trip.segments[i]) as any;
            }
        }
        newSegments[i] = seg;
        changed = true;
      }
    }

    if (changed) {
      updateTripState(trip.id, { ...trip, segments: newSegments });
    }
  };

  const handleUndo = () => {
    if (!selectedTrip) return;
    const h = histories[selectedTrip.id];
    if (!h || h.past.length === 0) return;

    const previousTrip = h.past[h.past.length - 1];
    setTrips(prev => prev.map(t => t.id === selectedTrip.id ? previousTrip : t));
    setSelectedTrip(previousTrip);

    setHistories(prev => {
      const targetStack = prev[selectedTrip.id];
      return {
        ...prev,
        [selectedTrip.id]: {
          past: targetStack.past.slice(0, -1),
          future: [selectedTrip, ...targetStack.future],
          lastSavedStr: targetStack.lastSavedStr
        }
      };
    });
  };

  const handleRedo = () => {
    if (!selectedTrip) return;
    const h = histories[selectedTrip.id];
    if (!h || h.future.length === 0) return;

    const nextTrip = h.future[0];
    setTrips(prev => prev.map(t => t.id === selectedTrip.id ? nextTrip : t));
    setSelectedTrip(nextTrip);

    setHistories(prev => {
      const targetStack = prev[selectedTrip.id];
      return {
        ...prev,
        [selectedTrip.id]: {
          past: [...targetStack.past, selectedTrip],
          future: targetStack.future.slice(1),
          lastSavedStr: targetStack.lastSavedStr
        }
      };
    });
  };

  const handleSave = async () => {
    if (!selectedTrip) return;
    
    try {
      const updatingTrip = { ...selectedTrip, updatedAt: new Date().toISOString() };
      
      if (persistingManager.getAvailableServices().length > 0) {
        await persistingManager.uploadToAll(updatingTrip);
      }

      const newTripState = computeTripCaches(updatingTrip);
      setTrips(prev => prev.map(t => t.id === selectedTrip.id ? newTripState : t));
      TripAPI.saveTrip(newTripState);

      setHistories(prev => {
        const h = prev[selectedTrip.id];
        return {
          ...prev,
          [selectedTrip.id]: {
            ...h,
            lastSavedStr: stripMeta(newTripState)
          }
        };
      });
    } catch (e) {
      console.error(e);
      alert(`Failed to save ${selectedTrip.name}`);
    }
  };

  const handleSaveAllUnsaved = async () => {
    const unsavedTrips = trips.filter(t => histories[t.id] && histories[t.id].lastSavedStr !== stripMeta(t));
    if (unsavedTrips.length === 0) return;

    try {
      const updatingTrips = unsavedTrips.map(u => ({ ...u, updatedAt: new Date().toISOString() }));
      
      if (persistingManager.getAvailableServices().length > 0) {
        await persistingManager.saveAll(updatingTrips);
      }

      const nextTrips = updatingTrips.map(u => computeTripCaches(u));

      setTrips(prev => prev.map(t => {
        const matching = nextTrips.find(n => n.id === t.id);
        return matching ? matching : t;
      }));
      
      nextTrips.forEach(t => TripAPI.saveTrip(t));

      setHistories(prev => {
        const next = { ...prev };
        nextTrips.forEach(t => {
          if (next[t.id]) {
            next[t.id] = { ...next[t.id], lastSavedStr: stripMeta(t) };
          }
        });
        return next;
      });
    } catch (e) {
      console.error(e);
      alert('Failed to save some trips');
    }
  };

  const handleCreateTrip = () => {
    const title = 'New Trip';
    const newId = slugify(title, trips.map(t => t.id));
    const newWpId = `wp_${Math.random().toString(36).substring(2, 9)}`;
    const newTrip = computeTripCaches({
      id: newId,
      name: title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      segments: [
        {
          id: `seg_${Math.random().toString(36).substring(2, 9)}`,
          transportMode: 'car',
          routingService: 'GraphHopper Router',
          routingProfile: 'car',
          source: 'router',
          geometry: { type: 'LineString', coordinates: [] },
          waypoints: [
            {
              id: newWpId,
              coordinates: [] as any,
              name: '',
            }
          ]
        }
      ]
    });
    
    setTrips(prev => [...prev, newTrip]);
    setHistories(prev => ({
      ...prev,
      [newTrip.id]: { past: [], future: [], lastSavedStr: stripMeta(newTrip) }
    }));
    
    setSelectedTrip(newTrip);
    setSelectedSegmentId(null);
    setSelectedWaypointId(null);

    // Focus the title input (give it a bit of time to render)
    setTimeout(() => {
      const inputs = document.querySelectorAll('.trip-header input[placeholder="Trip Name"]');
      if (inputs.length) {
        (inputs[0] as HTMLElement).focus();
      } else {
        const titleInputs = document.querySelectorAll('input[placeholder="Waypoint Name"], .waypoint-title-input');
        if (titleInputs.length) {
          (titleInputs[0] as HTMLElement).focus();
        }
      }
    }, 150);
  };

  // Uses stripMeta to ignore metadata differences (like syncedServices lists) for local unsaved status
  const unsavedTripIds = new Set(
    trips.filter(t => histories[t.id] && histories[t.id].lastSavedStr !== stripMeta(t)).map(t => t.id)
  );

  const handleResolveConflict = async (tripId: string, acceptedVersion: Trip) => {
    // 1. collect all sources involved
    const conflicts = tripConflicts[tripId] || [];
    const allSources = new Set<string>();
    conflicts.forEach((c: any) => {
      if (c.metadata?._sourceService) allSources.add(c.metadata._sourceService);
      (c.metadata?.syncedServices || []).forEach((s: string) => allSources.add(s));
    });
    
    // 2. make accepted version definitive 
    const finalTrip = { ...acceptedVersion };
    finalTrip.metadata = finalTrip.metadata || {};
    finalTrip.metadata.syncedServices = Array.from(allSources).filter(s => s !== 'Local Browser Storage');
    delete finalTrip.metadata._sourceService; // clean up internal marker

    // 3. update state
    const newTrips = trips.map(t => t.id === tripId ? finalTrip : t);
    setTrips(newTrips);
    
    setTripConflicts(prev => {
      const next = { ...prev };
      delete next[tripId];
      return next;
    });
    setResolvingTripId(null);
    
    // 4. save locally and upload all to sync remote places
    try {
      await TripAPI.saveTrip(finalTrip);
      setHistories(prev => ({
        ...prev,
        [tripId]: { past: [], future: [], lastSavedStr: stripMeta(finalTrip) }
      }));
      await persistingManager.uploadToAll(finalTrip);
    } catch (err) {
      console.error('Failed to upload resolved trip:', err);
    }
  };

  const handleGoBackTripEditor = () => {
    setSelectedTrip(null);
    setSelectedSegmentId(null);
    setSelectedWaypointId(null);
    setHighlightedWaypointId(null);
    setSelectedPOI(null);
  };

  const handleGoBackSegment = () => setSelectedSegmentId(null);
  const handleGoBackWaypoint = () => setSelectedWaypointId(null);
  const handleGoBackPOI = () => setSelectedPOI(null);

  const hotkeyRefs = useRef({ handleUndo, handleRedo, handleSave, handleSaveAllUnsaved, selectedTrip, selectedSegmentId, selectedWaypointId, handleGoBackTripEditor, handleGoBackSegment, handleGoBackWaypoint, updateTripState, handleCoordinateChange });
  useEffect(() => {
    hotkeyRefs.current = { handleUndo, handleRedo, handleSave, handleSaveAllUnsaved, selectedTrip, selectedSegmentId, selectedWaypointId, handleGoBackTripEditor, handleGoBackSegment, handleGoBackWaypoint, updateTripState, handleCoordinateChange };
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) hotkeyRefs.current.handleRedo();
          else hotkeyRefs.current.handleUndo();
        } else if (key === 'y') {
          e.preventDefault();
          hotkeyRefs.current.handleRedo();
        } else if (key === 's') {
          e.preventDefault();
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          if (hotkeyRefs.current.selectedTrip) {
            hotkeyRefs.current.handleSave();
          } else {
            hotkeyRefs.current.handleSaveAllUnsaved();
          }
        }
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (hotkeyRefs.current.selectedSegmentId) {
          hotkeyRefs.current.handleGoBackSegment();
        } else if (hotkeyRefs.current.selectedWaypointId) {
          hotkeyRefs.current.handleGoBackWaypoint();
        } else if (hotkeyRefs.current.selectedTrip) {
          hotkeyRefs.current.handleGoBackTripEditor();
        }
      } else if (e.key === 'Escape') {
        if (hotkeyRefs.current.selectedSegmentId) {
          e.preventDefault();
          hotkeyRefs.current.handleGoBackSegment();
        } else if (hotkeyRefs.current.selectedWaypointId) {
          e.preventDefault();
          hotkeyRefs.current.handleGoBackWaypoint();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    loadTrips();
  }, []);

  const mapComponentRef = useRef<MapRef>(null);

  const handleDeleteTrip = (tripId: string) => {
    setTrips(prev => prev.filter(t => t.id !== tripId));
    setHistories(prev => {
      const next = { ...prev };
      delete next[tripId];
      return next;
    });
    TripAPI.deleteTrip(tripId);
  };

  const handleUploadTrip = async (trip: Trip) => {
    try {
      await persistingManager.uploadToAll(trip);
      const newTripState = { ...trip };
      setTrips(prev => prev.map(t => t.id === trip.id ? newTripState : t));
      setHistories(prev => {
        if (!prev[trip.id]) return prev;
        return {
          ...prev,
          [trip.id]: {
            ...prev[trip.id],
            lastSavedStr: stripMeta(newTripState)
          }
        };
      });
    } catch (e) {
      console.error(e);
      alert(`Failed to upload ${trip.name}`);
    }
  };

  const handleSelectTrip = (trip: Trip) => {
    if (conflictedTripIds.has(trip.id)) {
      setResolvingTripId(trip.id);
      return;
    }
    setSelectedTrip(trip);
    setTimeout(() => {
      if (mapComponentRef.current) {
        mapComponentRef.current.zoomToTrip(trip);
      }
    }, 100);
  };

  const handleUpdateExternalTrips = (updatedTrips: Trip[]) => {
    setTrips(updatedTrips);
    setHistories(prev => {
      const next = { ...prev };
      updatedTrips.forEach(t => {
        if (next[t.id]) {
          next[t.id] = { ...next[t.id], lastSavedStr: stripMeta(t) };
        }
      });
      return next;
    });
    updatedTrips.forEach(t => TripAPI.saveTrip(t));
  };

  return (
    <>
      <div className="layout">
      <div className="sidebar">
        {isStatusOpen ? (
          <StatusPanel
            onGoBack={() => setIsStatusOpen(false)}
            trips={trips}
            onUpdateTrips={handleUpdateExternalTrips}
          />
        ) : isSearchOpen ? (
          <SearchPanel 
            onGoBack={() => setIsSearchOpen(false)}
            onResultClick={(result) => {
              if (Array.isArray(result)) {
                mapComponentRef.current?.flyTo(result[0], result[1]);
              } else {
                mapComponentRef.current?.flyTo(parseFloat(result.lon), parseFloat(result.lat));
                const newPoi = {
                  id: `search-${result.osm_type}-${result.osm_id}`,
                  name: result.name || result.display_name.split(',')[0],
                  class: result.class,
                  subclass: result.type,
                  coordinates: [parseFloat(result.lon), parseFloat(result.lat)],
                  properties: { name: result.name || result.display_name.split(',')[0] }
                };
                setSelectedPOI(newPoi);
                setIsSearchOpen(false);
              }
            }}
          />
        ) : selectedPOI ? (
          <POIInfo
            poi={selectedPOI}
            trip={selectedTrip}
            onGoBack={handleGoBackPOI}
            onUpdateTrip={(newTrip) => updateTripState(newTrip.id, newTrip)}            onAddedToTrip={(wpId) => {
              handleGoBackPOI();
              setHighlightedWaypointId(wpId);
            }}          />
        ) : selectedSegmentId && selectedTrip ? (
          <SegmentInfo 
            segmentId={selectedSegmentId} 
            trip={selectedTrip} 
            allTrips={trips}
            onGoBack={handleGoBackSegment} 
            onUpdateTrip={(newTrip) => updateTripState(selectedTrip.id, newTrip)}
            hoveredCoordinate={hoveredCoordinate}
            onHoverCoordinate={setHoveredCoordinate}
            onZoomToSegment={(seg) => mapComponentRef.current?.zoomToSegment(seg)}
          />
        ) : selectedWaypointId && selectedTrip ? (
          <WaypointInfo 
            waypointId={selectedWaypointId} 
            trip={selectedTrip} 
            onGoBack={handleGoBackWaypoint} 
            onUpdateTrip={(newTrip) => updateTripState(selectedTrip.id, newTrip)}
          />
        ) : !selectedTrip ? (
          <TripManager
            trips={trips}
            onSelectTrip={handleSelectTrip}
            onDeleteTrip={handleDeleteTrip}
              onUploadTrip={handleUploadTrip}
              onReloadTrips={loadTrips}
            unsavedTripIds={unsavedTripIds}              conflictedTripIds={conflictedTripIds}            onSaveAll={handleSaveAllUnsaved}
            onCreateTrip={handleCreateTrip}
            onOpenStatus={() => setIsStatusOpen(true)}
          />
        ) : (
          <TripEditor 
            trip={selectedTrip} 
            onGoBack={handleGoBackTripEditor} 
            onSelectSegment={setSelectedSegmentId}
            onSelectWaypoint={setSelectedWaypointId}
            onZoomToTrip={() => mapComponentRef.current?.zoomToTrip(selectedTrip)}
            onJumpToWaypoint={(id) => mapComponentRef.current?.handleJumpToWaypoint(id)}
            highlightedWaypointId={highlightedWaypointId}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={!!histories[selectedTrip.id]?.past.length}
            canRedo={!!histories[selectedTrip.id]?.future.length}
            onSave={handleSave}
            canSave={histories[selectedTrip.id]?.lastSavedStr !== stripMeta(selectedTrip)}
            onUpdateTrip={(newTrip) => updateTripState(selectedTrip.id, newTrip)}
            onWaitingForCoords={(wpId) => {
              setWaitingWaypointId(wpId);
              waitingWaypointIdRef.current = wpId;
            }}
          />
        )}
      </div>
      <Map
        ref={mapComponentRef}
        trips={trips}
        selectedTrip={selectedTrip}
        waitingWaypointId={waitingWaypointId}
        waitingWaypointIdRef={waitingWaypointIdRef}
        setWaitingWaypointId={setWaitingWaypointId}
        updateTripState={updateTripState}
        handleCoordinateChange={handleCoordinateChange}
        setSelectedWaypointId={setSelectedWaypointId}
        setHighlightedWaypointId={setHighlightedWaypointId}
        setSelectedSegmentId={setSelectedSegmentId}
        selectedPOI={selectedPOI}
        setSelectedPOI={setSelectedPOI}
        hoveredCoordinate={hoveredCoordinate}
        onHoverCoordinate={setHoveredCoordinate}
        onSearchClick={() => setIsSearchOpen(true)}
        onSelectTrip={handleSelectTrip}
      />
    </div>

    {resolvingTripId && <Dialog
      isOpen={true}
      title="Resolve Trip Conflict"
      onClose={() => setResolvingTripId(null)}
      actions={
        <button className="dialog-btn dialog-btn-cancel" onClick={() => setResolvingTripId(null)}>Cancel</button>
      }
    >
      <div className="conflict-dialog">
        <p>This trip has conflicting versions from different sources. Please select the version you want to keep. The chosen version will overwrite the others.</p>
        <div className="conflict-list">
          {(tripConflicts[resolvingTripId] || []).map((t, i) => (
            <div key={i} className="conflict-item">
              <h4>Source: {t.metadata?._sourceService || 'Unknown'}</h4>
              <p>Last modified: {new Date(t.updatedAt).toLocaleString()}</p>
              <button className="dialog-btn dialog-btn-primary" onClick={() => handleResolveConflict(resolvingTripId, t)}>Keep this version</button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>}
    </>
  );
}
