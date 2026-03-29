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

import { TripManager } from './components/TripManager';
import { TripEditor } from './components/TripEditor';
import { SegmentInfo } from './components/SegmentInfo';
import { WaypointInfo } from './components/WaypointInfo';
import { POIInfo } from './components/POIInfo';
import { SearchPanel } from './components/SearchPanel';
import { StatusPanel } from './components/StatusPanel';
import { Map } from './components/Map';
import type { MapRef } from './components/Map';

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [histories, setHistories] = useState<Record<string, { past: Trip[], future: Trip[], lastSavedStr: string }>>({});
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [selectedPOI, setSelectedPOI] = useState<any | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [highlightedWaypointId, setHighlightedWaypointId] = useState<string | null>(null);
  const [hoveredCoordinate, setHoveredCoordinate] = useState<{ lon: number; lat: number; ele?: number } | null>(null);
  const [waitingWaypointId, setWaitingWaypointId] = useState<string | null>(null);
  const waitingWaypointIdRef = useRef<string | null>(null);

  const loadTrips = () => {
    TripAPI.getTrips().then(fetchedTrips => {
      setTrips(fetchedTrips);
      const initHistories: Record<string, { past: Trip[], future: Trip[], lastSavedStr: string }> = {};
      fetchedTrips.forEach(t => {
        initHistories[t.id] = { past: [], future: [], lastSavedStr: JSON.stringify(t) };
      });
      setHistories(initHistories);
    });
  };

  const updateTripState = (tripId: string, newTrip: Trip, replaceLastHistory: boolean = false) => {
    setTrips(prev => prev.map(t => t.id === tripId ? newTrip : t));

    setHistories(prev => {
      const h = prev[tripId] || { past: [], future: [], lastSavedStr: '' };
      const currentTrip = trips.find(t => t.id === tripId) || newTrip;
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
      setSelectedTrip(newTrip);
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

  const handleSave = () => {
    if (!selectedTrip) return;
    setHistories(prev => {
      const h = prev[selectedTrip.id];
      return {
        ...prev,
        [selectedTrip.id]: {
          ...h,
          lastSavedStr: JSON.stringify(selectedTrip)
        }
      };
    });
  };

  const handleSaveAllUnsaved = () => {
    setHistories(prev => {
      const next = { ...prev };
      trips.forEach(t => {
        if (next[t.id] && next[t.id].lastSavedStr !== JSON.stringify(t)) {
          next[t.id] = { ...next[t.id], lastSavedStr: JSON.stringify(t) };
        }
      });
      return next;
    });
  };

  const handleCreateTrip = () => {
    const newWpId = `wp_${Math.random().toString(36).substring(2, 9)}`;
    const newTrip: Trip = {
      id: `trip_${Math.random().toString(36).substring(2, 9)}`,
      name: 'New Trip',
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
              importance: 'normal',
              name: '',
            }
          ]
        }
      ]
    };
    
    setTrips(prev => [...prev, newTrip]);
    setHistories(prev => ({
      ...prev,
      [newTrip.id]: { past: [], future: [], lastSavedStr: JSON.stringify(newTrip) }
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

  const unsavedTripIds = new Set(
    trips.filter(t => histories[t.id] && histories[t.id].lastSavedStr !== JSON.stringify(t)).map(t => t.id)
  );

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

  const handleSelectTrip = (trip: Trip) => {
    setSelectedTrip(trip);
    setTimeout(() => {
      if (mapComponentRef.current) {
        mapComponentRef.current.zoomToTrip(trip);
      }
    }, 100);
  };

  return (
    <div className="layout">
      <div className="sidebar">
        {isStatusOpen ? (
          <StatusPanel onGoBack={() => setIsStatusOpen(false)} />
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
            onGoBack={handleGoBackSegment} 
            onUpdateTrip={(newTrip) => updateTripState(selectedTrip.id, newTrip)}
            hoveredCoordinate={hoveredCoordinate}
            onHoverCoordinate={setHoveredCoordinate}
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
            unsavedTripIds={unsavedTripIds}
            onSaveAll={handleSaveAllUnsaved}
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
            canSave={histories[selectedTrip.id]?.lastSavedStr !== JSON.stringify(selectedTrip)}
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
      />
    </div>
  );
}
