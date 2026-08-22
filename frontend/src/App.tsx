import { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import './styles/App.css';
import './styles/Shared.css';
import './styles/TripManager.css';
import './styles/TripEditor.css';
import './styles/WaypointInfo.css';
import './styles/StatusPanel.css';
import './styles/Mobile.css';
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
import { AnalyticsPanel } from './components/AnalyticsPanel';
import PreferencesPanel from './components/PreferencesPanel';
import { persistingManager } from './persisting/PersistingManager';
import { hasUnsyncedPreferences, loadPreferencesFromCloud, syncPreferencesToCloud } from './utils/preferencesSync';
import { resolvePOIName } from './utils/poiUtils';
import { Map } from './components/Map';
import type { MapRef } from './components/Map';
import { SetupWizard } from './components/SetupWizard';

const TRIP_CACHE_KEY = 'triplo_cached_trips_v2';
type PreferenceVersion = { source: string; preferences: any };

const getSharedTripTokenFromPath = () => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = window.location.pathname;
  const relativePath = path.startsWith(base) ? path.slice(base.length) : path;

  const match = relativePath.match(/^\/share\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
};

const unavailableSharedTripMessage = 'This trip was deleted or made private by the owner.';

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('TriploDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('trips')) {
        db.createObjectStore('trips');
      }
    };
  });
};

const saveTripCache = async (trips: Trip[]) => {
  try {
    // Shared trips are only references in user storage. Never retain their
    // fetched content in the offline cache.
    const cached = trips.filter(t => !t.metadata?.isSharedTripReference).map(t => ({
      ...t,
      metadata: { ...t.metadata, _isCached: true }
    }));
    const db = await initDB();
    const tx = db.transaction('trips', 'readwrite');
    const store = tx.objectStore('trips');
    store.put(cached, TRIP_CACHE_KEY);
  } catch (error) { console.warn("Cache save failed", error); }
};

const getTripCache = async (): Promise<Trip[]> => {
  try {
    const db = await initDB();
    const tx = db.transaction('trips', 'readonly');
    const store = tx.objectStore('trips');
    const request = store.get(TRIP_CACHE_KEY);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve((request.result || []).filter((trip: Trip) => !trip.metadata?.isSharedTripReference));
      request.onerror = () => reject(request.error);
    });
  } catch {
  }
  return [];
};

export default function App() {
  const [isReadOnly, setIsReadOnly] = useState<boolean>(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [histories, setHistories] = useState<Record<string, { past: Trip[], future: Trip[], lastSavedStr: string }>>({});
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [tripConflicts, setTripConflicts] = useState<Record<string, Trip[]>>({});
  const conflictedTripIds = new Set(Object.keys(tripConflicts));
  const [preferenceConflicts, setPreferenceConflicts] = useState<PreferenceVersion[]>([]);
  const [missingTrips, setMissingTrips] = useState<Record<string, string[]>>({});
  const [showConflictResolution, setShowConflictResolution] = useState(false);
  const [activeConflictSave, setActiveConflictSave] = useState<string | null>(null);
  const [uploadingMissingTripId, setUploadingMissingTripId] = useState<string | null>(null);
  const [isAcceptingAllConflicts, setIsAcceptingAllConflicts] = useState(false);

  useEffect(() => {
    if (showConflictResolution && preferenceConflicts.length === 0 && Object.keys(tripConflicts).length === 0 && Object.keys(missingTrips).length === 0) {
      setShowConflictResolution(false);
    }
  }, [showConflictResolution, preferenceConflicts, tripConflicts, missingTrips]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedWaypointId, setSelectedWaypointId] = useState<string | null>(null);
  const [selectedPOI, setSelectedPOI] = useState<any | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isStatusOpen, setIsStatusOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [analyticsSegmentInfo, setAnalyticsSegmentInfo] = useState<{ tripId: string; segmentId: string } | null>(null);
  const analyticsStyleSegment = analyticsSegmentInfo
    ? trips.find(trip => trip.id === analyticsSegmentInfo.tripId)?.segments.find(segment => segment.id === analyticsSegmentInfo.segmentId) || null
    : null;
  const [attachingPoiToWaypointId, setAttachingPoiToWaypointId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    window.innerWidth <= 768 && !!getSharedTripTokenFromPath()
  );
  const touchStartRef = useRef<{ y: number, isContentEdge: boolean } | null>(null);
  const [highlightedWaypointId, setHighlightedWaypointId] = useState<string | null>(null);
  const [hoveredCoordinate, setHoveredCoordinate] = useState<{ lon: number; lat: number; ele?: number } | null>(null);
  const [exitingTempTripAlert, setExitingTempTripAlert] = useState<boolean>(false);
  const [waitingWaypointId, setWaitingWaypointId] = useState<string | null>(null);
  const waitingWaypointIdRef = useRef<string | null>(null);
  const [isLoadingTrips, setIsLoadingTrips] = useState(true);
  const [sharedTripError, setSharedTripError] = useState<string | null>(null);
  const [isViewingSharedTrip, setIsViewingSharedTrip] = useState(false);
  const [isLoadingSharedTrip, setIsLoadingSharedTrip] = useState(() => !!getSharedTripTokenFromPath());
  const [sharedTripId, setSharedTripId] = useState<string | null>(null);
  const [showSetupWizard, setShowSetupWizard] = useState(() => persistingManager.getAvailableServices().length === 0 && !getSharedTripTokenFromPath());
  const [setupWizardCallback, setSetupWizardCallback] = useState<(() => void | Promise<void>) | null>(null);

  const promptSetupWizard = (onSuccess?: () => void | Promise<void>) => {
    setSetupWizardCallback(() => onSuccess || null);
    setShowSetupWizard(true);
  };

  const handleSetupWizardComplete = async () => {
    setShowSetupWizard(false);
    if (setupWizardCallback) {
      const callback = setupWizardCallback;
      setSetupWizardCallback(null);
      await callback();
    }
  };

  const stripMeta = (t: Trip) => {
    const copy: any = { ...t };
    delete copy.metadata;
    return JSON.stringify(copy);
  };

  const loadTrips = async () => {
    setIsLoadingTrips(true);
    try {
      if (trips.length === 0) {
          const localCache = await getTripCache();
          if (localCache.length > 0) {
              setTrips(localCache);
          }
      }

      const apiTrips = await TripAPI.getTrips();
      const remoteTrips = await persistingManager.loadAllTrips();
      const preferenceVersions = await persistingManager.loadPreferencesFromAll();
      const preferenceTimestamp = (prefs: any) => {
        const timestamp = prefs?.updatedAt ? new Date(prefs.updatedAt).getTime() : Number.NEGATIVE_INFINITY;
        return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
      };
      const newestPreferences = [...preferenceVersions].sort((a, b) => preferenceTimestamp(b.preferences) - preferenceTimestamp(a.preferences))[0];
      if (newestPreferences) await loadPreferencesFromCloud(newestPreferences.preferences, newestPreferences.source);
      const comparablePreferences = (prefs: any) => {
        const copy = { ...prefs };
        delete copy.updatedAt;
        return JSON.stringify(copy);
      };
      const uniquePreferenceVersions = new Set(preferenceVersions.map(version => comparablePreferences(version.preferences)));
      const preferencesInConflict = uniquePreferenceVersions.size > 1 ? preferenceVersions : [];
      setPreferenceConflicts(preferencesInConflict);

      const variantsByTripId: Record<string, Trip[]> = {};
      const conflictsFound: Record<string, Trip[]> = {};

      apiTrips.forEach(t => {
        // Shared-trip references are metadata-only records. Their complete
        // trip is resolved by the persisting manager from the share link.
        if (t.metadata?.isSharedTripReference) return;
        t.metadata = t.metadata || {};
        t.metadata._sourceService = 'Local Browser Storage';
        variantsByTripId[t.id] = [t];
      });

      remoteTrips.forEach((t: Trip) => {
        if (!variantsByTripId[t.id]) variantsByTripId[t.id] = [];
        variantsByTripId[t.id].push(t);
      });

      const tripsMap = new globalThis.Map<string, Trip>();
      const missingServicesByTrip: Record<string, string[]> = {};
      const serviceNames = persistingManager.getAvailableServices().map(service => service.name);

      Object.entries(variantsByTripId).forEach(([id, variants]) => {
        const presentServices = new Set(variants
          .map(variant => variant.metadata?._sourceService)
          .filter((source): source is string => !!source && source !== 'Local Browser Storage'));
        const missingServices = serviceNames.filter(service => !presentServices.has(service));
        if (missingServices.length > 0) missingServicesByTrip[id] = missingServices;
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
          const savedSharedReference = variants.find(v => v.metadata?.isSharedTripReference);
          if (savedSharedReference) {
            newest.metadata.isSharedTripReference = true;
            newest.metadata.shareLink = savedSharedReference.metadata?.shareLink;
            newest.metadata.sharedService = savedSharedReference.metadata?.sharedService;
            if (!newest.metadata.sharedTripUnavailable) {
              delete newest.metadata.sharedTripUnavailable;
            }
          }
          // Keep Local Browser Storage as the active working source tag
          newest.metadata._sourceService = 'Local Browser Storage';

          tripsMap.set(id, newest);
        }
      });

      setTripConflicts(conflictsFound);
      setMissingTrips(missingServicesByTrip);

      const fetchedTrips = Array.from(tripsMap.values());

        let oldCache = [ ...trips ];
        if (oldCache.length === 0) {
           oldCache = await getTripCache();
        }

        const cachedTrips: Trip[] = [];
        for (const trip of fetchedTrips) {
          // Yield to UI thread to prevent freezing on heavy local geometry compute
          await new Promise(resolve => setTimeout(resolve, 0));
          
          const existing = oldCache.find(t => t.id === trip.id);
          const freshMetadata = { ...(trip.metadata || {}) };
          delete (freshMetadata as any)._isCached;
          if (existing && existing.updatedAt === trip.updatedAt && existing.tripDistanceSummary) {
             cachedTrips.push({
                ...existing,
                metadata: { ...existing.metadata, ...freshMetadata, _isCached: false }
             });
          } else {
             const newlyComputed = computeTripCaches(trip);
             newlyComputed.metadata = { ...newlyComputed.metadata, ...freshMetadata, _isCached: false };
             cachedTrips.push(newlyComputed);
          }
        }

      setTrips(cachedTrips);
      saveTripCache(cachedTrips);
      const initHistories: Record<string, { past: Trip[], future: Trip[], lastSavedStr: string }> = {};
      cachedTrips.forEach(t => {
        initHistories[t.id] = { past: [], future: [], lastSavedStr: stripMeta(t) };
      });
      setHistories(initHistories);
      if (localStorage.getItem('defaultReadOnly') !== 'true') {
        setIsReadOnly(false);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingTrips(false);
    }
  };

  const persistOwnedTrip = async (trip: Trip): Promise<void> => {
    const cachedTrip = computeTripCaches(trip);
    await persistingManager.uploadToAll(cachedTrip);
    await TripAPI.saveTrip(cachedTrip);
    setTrips(prev => {
      const existingIndex = prev.findIndex(item => item.id === cachedTrip.id);
      if (existingIndex === -1) return [...prev, cachedTrip];
      const next = [...prev];
      next[existingIndex] = cachedTrip;
      return next;
    });
    setHistories(prev => ({
      ...prev,
      [cachedTrip.id]: { past: [], future: [], lastSavedStr: stripMeta(cachedTrip) }
    }));
    setSelectedTrip(cachedTrip);
    setIsViewingSharedTrip(false);
    if (getSharedTripTokenFromPath()) {
      window.history.replaceState({}, '', '/');
    }
  };

  const saveSharedTripReference = async (trip: Trip): Promise<void> => {
    const reference = await persistingManager.saveSharedTripReference(trip);
    const savedTrip = {
      ...computeTripCaches(trip),
      metadata: { ...(trip.metadata || {}), ...reference.metadata, shareLink: reference.shareLink },
    };
    await TripAPI.saveTrip(reference as unknown as Trip);
    setTrips(prev => {
      const index = prev.findIndex(item => item.id === savedTrip.id);
      if (index === -1) return [...prev, savedTrip];
      const next = [...prev];
      next[index] = savedTrip;
      return next;
    });
    setHistories(prev => ({
      ...prev,
      [savedTrip.id]: { past: [], future: [], lastSavedStr: stripMeta(savedTrip) }
    }));
    setSelectedTrip(savedTrip);
  };

  const updateTripState = (tripId: string, newTrip: Trip, replaceLastHistory: boolean = false, affectedSegmentIds?: string[]) => {
    let affectedSegments = affectedSegmentIds;
    if (!affectedSegments) {
      const currentTrip = trips.find(t => t.id === tripId) || selectedTrip;
      if (currentTrip && currentTrip.segments.length > 0) {
        affectedSegments = newTrip.segments
          .filter(newSeg => {
             const oldSeg = currentTrip.segments.find(s => s.id === newSeg.id);
             return oldSeg !== newSeg;
          })
          .map(s => s.id);
      }
    }

    const cachedTrip = computeTripCaches(newTrip, affectedSegments);
    setTrips(prev => prev.map(t => t.id === tripId ? cachedTrip : t));

    setHistories(prev => {
      const h = prev[tripId] || { past: [], future: [], lastSavedStr: '' };
      const currentTrip = trips.find(t => t.id === tripId) || (selectedTrip?.id === tripId ? selectedTrip : cachedTrip);
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

  const handleSetHighlightedWaypointId = useCallback((id: string | null) => {
    setHighlightedWaypointId(id);
    if (id) setIsSidebarCollapsed(false);
  }, []);

  const handleCoordinateChange = async (trip: Trip, wpId: string, coords: [number, number]) => {
    const newSegments = [...trip.segments];
    let changed = false;
    const affectedSegmentIds: string[] = [];

    for (let i = 0; i < newSegments.length; i++) {
      const seg = { ...newSegments[i] };
      const wpIdx = seg.waypoints.findIndex(w => w.id === wpId);
      if (wpIdx > -1) {
        seg.waypoints = seg.waypoints.map(w => w.id === wpId ? { ...w, coordinates: coords } : w);
        
        if (seg.source === 'router') {
            const validCoords = seg.waypoints.filter(w => w.coordinates && w.coordinates.length === 2).map(w => w.coordinates);
            if (validCoords.length >= 2) {
              const optimizedGeometry = await optimizeSegmentRoute(seg, trip.segments[i]);
              if (optimizedGeometry) {
                seg.geometry = optimizedGeometry;
              }
            }
        }
        newSegments[i] = seg;
        changed = true;
        affectedSegmentIds.push(seg.id);
      }
    }

    if (changed) {
      updateTripState(trip.id, { ...trip, segments: newSegments }, false, affectedSegmentIds);
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
    if (!selectedTrip) return false;
    
    try {
      const tripToSave = { ...selectedTrip, updatedAt: new Date().toISOString() };
      
      const isNew = tripToSave.id.startsWith('temp_trip_');
      const oldId = tripToSave.id;
      if (isNew) {
        const title = tripToSave.name.trim() || 'New Trip';
        const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
        let randomStr = '';
        for (let i = 0; i < 6; i++) {
          randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        const baseSlug = slugify(title, trips.map(t => t.id));
        tripToSave.id = `${baseSlug}_${randomStr}`;
      }

      if (persistingManager.getAvailableServices().length > 0) {
        await persistingManager.uploadToAll(tripToSave);
      }
      if (tripToSave.metadata?.shareLink && !tripToSave.metadata?.isSharedTripReference) {
        await persistingManager.updateSharedTrip(tripToSave.metadata.shareLink, tripToSave);
      }

      const newTripState = computeTripCaches(tripToSave);
      
      setTrips(prev => {
        if (isNew) {
            return [...prev, newTripState];
        }
        return prev.map(t => t.id === newTripState.id ? newTripState : t);
      });
      
      await TripAPI.saveTrip(newTripState);

      setHistories(prev => {
        const h = prev[oldId] || { past: [], future: [], lastSavedStr: '' };
        const next = { ...prev };
        if (isNew) {
          delete next[oldId]; // Clean up temp history
        }
        next[newTripState.id] = {
          past: h.past.map(p => ({ ...p, id: newTripState.id })),
          future: h.future.map(f => ({ ...f, id: newTripState.id })),
          lastSavedStr: stripMeta(newTripState)
        };
        return next;
      });
      
      if (selectedTrip && selectedTrip.id === oldId) {
         setSelectedTrip(newTripState);
      }
      return true;
    } catch (e) {
      console.error(e);
      alert('Failed to save trip');
      return false;
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
      await Promise.all(updatingTrips
        .filter(trip => trip.metadata?.shareLink && !trip.metadata?.isSharedTripReference)
        .map(trip => persistingManager.updateSharedTrip(trip.metadata.shareLink, trip)));

      const nextTrips = updatingTrips.map(u => computeTripCaches(u));

      setTrips(prev => prev.map(t => {
        const matching = nextTrips.find(n => n.id === t.id);
        return matching ? matching : t;
      }));
      
      await Promise.all(nextTrips.map(t => TripAPI.saveTrip(t)));

      setHistories(prev => {
        const next = { ...prev };
        nextTrips.forEach(t => {
          if (next[t.id]) {
            next[t.id] = { ...next[t.id], lastSavedStr: stripMeta(t) };
          }
        });
        return next;
      });

      if (selectedTrip) {
        const updatedSelected = nextTrips.find(n => n.id === selectedTrip.id);
        if (updatedSelected) {
          setSelectedTrip(updatedSelected);
        }
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save some trips');
    }
  };

  const handleCreateTrip = (initialPoi?: any, initialDetails?: any) => {
    const title = initialPoi?.name || initialDetails?.name || initialDetails?.display_name || 'New Trip';
    const tempId = `temp_trip_${Math.random().toString(36).substring(2, 9)}`;
    const newWpId = `wp_${Math.random().toString(36).substring(2, 9)}`;
    const initialCoords = initialPoi?.coordinates || [];

    const newTrip = computeTripCaches({
      id: tempId,
      name: title as string,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      segments: [
        {
          id: `seg_${Math.random().toString(36).substring(2, 9)}`,
          transportMode: 'car',
          routingService: 'GraphHopper Router',
          routingProfile: 'car',
          source: 'router',
          geometry: { type: 'LineString', coordinates: initialCoords.length > 0 ? [initialCoords] : [] },
          waypoints: [
            {
              id: newWpId,
              coordinates: initialCoords as [number, number],
              name: initialPoi?.name || initialDetails?.name || initialDetails?.display_name || '',
              ...(initialPoi ? {
                poi: {
                  id: initialPoi.id || initialPoi.properties?.id || initialDetails?.osm_id,
                  name: initialPoi.name || initialDetails?.name || initialDetails?.display_name,
                  type: initialPoi.class,
                  details: initialDetails
                }
              } : {})
            }
          ]
        }
      ]
    });

    setHistories(prev => ({
      ...prev,
      [newTrip.id]: { past: [], future: [], lastSavedStr: "" }
    }));

    setSelectedTrip(newTrip);
    setSelectedSegmentId(null);
    setSelectedWaypointId(null);
    setIsSidebarCollapsed(false);

    // Give it a bit of time to render the new trip editor
    setTimeout(() => {
      if (window.innerWidth <= 768) return; // Prevent layout bouncing on mobile keyboard popup
      const inputs = document.querySelectorAll('.trip-header input[placeholder="Trip Name"]');
      if (inputs.length) {
        (inputs[0] as HTMLElement).focus();
        setTimeout(() => { (inputs[0] as HTMLInputElement).select(); }, 50);
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

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsavedTripIds.size === 0 && !hasUnsyncedPreferences()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [unsavedTripIds.size]);

  const handleResolveConflict = async (tripId: string, acceptedVersion: Trip) => {
    setActiveConflictSave(`trip:${tripId}`);
    try {
    // 1. collect all sources involved
    const conflicts = tripConflicts[tripId] || [];
    const allSources = new Set<string>();
    conflicts.forEach((c: Trip) => {
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
    
    // 4. save locally and upload all to sync remote places
    try {
      await TripAPI.saveTrip(finalTrip);
      setHistories(prev => ({
        ...prev,
        [tripId]: { past: [], future: [], lastSavedStr: stripMeta(finalTrip) }
      }));
      await persistingManager.uploadToAll(finalTrip);
      setTripConflicts(prev => {
        const next = { ...prev };
        delete next[tripId];
        return next;
      });
      setMissingTrips(prev => {
        const next = { ...prev };
        delete next[tripId];
        return next;
      });
    } catch (err) {
      console.error('Failed to upload resolved trip:', err);
    }
    } finally {
      setActiveConflictSave(null);
    }
  };

  const handleResolvePreferenceConflict = async (version: PreferenceVersion) => {
    setActiveConflictSave('preferences');
    try {
      await loadPreferencesFromCloud(version.preferences, version.source);
      await syncPreferencesToCloud(true, undefined, true);
      setPreferenceConflicts([]);
    } finally {
      setActiveConflictSave(null);
    }
  };

  const handleUploadMissingTrip = async (tripId: string) => {
    const services = missingTrips[tripId];
    const trip = trips.find(item => item.id === tripId);
    if (!trip || !services) return;
    setUploadingMissingTripId(tripId);
    try {
      await persistingManager.uploadToServices(trip, services);
      setMissingTrips(prev => {
        const next = { ...prev };
        delete next[tripId];
        return next;
      });
    } finally {
      setUploadingMissingTripId(null);
    }
  };

  const handleAcceptLatestAndUploadMissing = async () => {
    flushSync(() => setIsAcceptingAllConflicts(true));
    try {
      const newestPreference = [...preferenceConflicts].sort((a, b) =>
        new Date(b.preferences.updatedAt || 0).getTime() - new Date(a.preferences.updatedAt || 0).getTime()
      )[0];
      if (newestPreference) await handleResolvePreferenceConflict(newestPreference);

      for (const [tripId, versions] of Object.entries(tripConflicts)) {
        const newestTrip = [...versions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
        if (newestTrip) await handleResolveConflict(tripId, newestTrip);
      }
      const conflictedIds = new Set(Object.keys(tripConflicts));
      await Promise.all(Object.entries(missingTrips).map(async ([tripId, services]) => {
        if (conflictedIds.has(tripId)) return;
        const trip = trips.find(item => item.id === tripId);
        if (trip) await persistingManager.uploadToServices(trip, services);
      }));
      setMissingTrips({});
      setShowConflictResolution(false);
    } finally {
      setIsAcceptingAllConflicts(false);
    }
  };

  const handleGoBackTripEditor = () => {
    if (selectedTrip && selectedTrip.id.startsWith('temp_trip_')) {
      setExitingTempTripAlert(true);
      return;
    }

    const performGoBack = () => {
      setSelectedTrip(null);
      setSelectedSegmentId(null);
      setSelectedWaypointId(null);
      setHighlightedWaypointId(null);
      setSelectedPOI(null);
      setAttachingPoiToWaypointId(null);
      if (getSharedTripTokenFromPath()) {
        window.history.replaceState({}, '', '/');
      }
      setIsViewingSharedTrip(false);
    };

    if (persistingManager.getAvailableServices().length === 0) {
      promptSetupWizard(performGoBack);
      return;
    }

    performGoBack();
  };

  const handleGoBackSegment = () => setSelectedSegmentId(null);
  const handleGoBackWaypoint = () => { 
    setSelectedWaypointId(null);
    setAttachingPoiToWaypointId(null);
  };
  const handleGoBackPOI = () => setSelectedPOI(null);

  useEffect(() => {
    if (
      selectedSegmentId ||
      selectedPOI ||
      !selectedWaypointId ||
      (attachingPoiToWaypointId && attachingPoiToWaypointId !== selectedWaypointId) ||
      isPreferencesOpen ||
      isStatusOpen ||
      isAnalyticsOpen ||
      isSearchOpen
    ) {
      setAttachingPoiToWaypointId(null);
    }
  }, [
    selectedSegmentId,
    selectedPOI,
    selectedWaypointId,
    attachingPoiToWaypointId,
    isPreferencesOpen,
    isStatusOpen,
    isAnalyticsOpen,
    isSearchOpen
  ]);

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

  useEffect(() => {
    const loadSharedTrip = async () => {
      const shareLink = getSharedTripTokenFromPath();
      if (!shareLink) return;

      setShowSetupWizard(false);
      setSharedTripError(null);
      setIsLoadingSharedTrip(true);

      try {
        const sharedTrip = await persistingManager.fetchSharedTrip(shareLink);
        if (!sharedTrip) {
          throw new Error('This shared trip could not be loaded.');
        }

        const cachedSharedTrip = computeTripCaches(sharedTrip);
        setSelectedTrip(cachedSharedTrip);
        setSharedTripId(cachedSharedTrip.id);
        setIsViewingSharedTrip(true);
        setIsReadOnly(true);
        setIsSidebarCollapsed(window.innerWidth <= 768);
        setTimeout(() => mapComponentRef.current?.zoomToTrip(cachedSharedTrip, 'open', 'trip'), 0);
      } catch (error) {
        console.error('Failed to load shared trip:', error);
        setSharedTripError(unavailableSharedTripMessage);
      } finally {
        setIsLoadingSharedTrip(false);
      }
    };

    loadSharedTrip();

    const handlePopState = () => {
      loadSharedTrip();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (isLoadingTrips || !sharedTripId) return;
    const ownTrip = trips.find(trip => trip.id === sharedTripId && !trip.metadata?.isSharedTripReference);
    const savedSharedTrip = trips.find(trip => trip.id === sharedTripId && trip.metadata?.isSharedTripReference);
    if (ownTrip) {
      setSelectedTrip(ownTrip);
      setIsViewingSharedTrip(false);
      if (localStorage.getItem('defaultReadOnly') !== 'true') {
        setIsReadOnly(false);
      }
      setTimeout(() => mapComponentRef.current?.zoomToTrip(ownTrip, 'open', 'trip'), 0);
    } else if (savedSharedTrip) {
      setSelectedTrip(savedSharedTrip);
      setIsViewingSharedTrip(true);
      setIsSidebarCollapsed(window.innerWidth <= 768);
    }
  }, [isLoadingTrips, sharedTripId, trips]);

  useEffect(() => {
    if (!isLoadingTrips) {
      saveTripCache(trips);
    }
  }, [trips, isLoadingTrips]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasUnsavedChanges = trips.some(
        t => histories[t.id] && histories[t.id].lastSavedStr !== stripMeta(t)
      );
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [trips, histories]);

  const mapComponentRef = useRef<MapRef>(null);

  const handleDeleteTrip = async (tripId: string) => {
    setTrips(prev => prev.filter(t => t.id !== tripId));
    setHistories(prev => {
      const next = { ...prev };
      delete next[tripId];
      return next;
    });
    TripAPI.deleteTrip(tripId);
    
    if (persistingManager.getAvailableServices().length > 0) {
      await persistingManager.deleteFromAll(tripId);
    }
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

  const handleSelectTrip = (trip: Trip, maintainState?: boolean) => {
    if (trip.metadata?.sharedTripUnavailable) {
      setSharedTripError(unavailableSharedTripMessage);
      return;
    }
    if (conflictedTripIds.has(trip.id)) {
      setShowConflictResolution(true);
      return;
    }
    setIsStatusOpen(false);
    setIsAnalyticsOpen(false);
    setIsPreferencesOpen(false);
    setSelectedWaypointId(null);
    setSelectedSegmentId(null);
    setSelectedTrip(trip);
    setIsViewingSharedTrip(false);

    if (maintainState) return;

    setIsSidebarCollapsed(true);

    setTimeout(() => {
      if (mapComponentRef.current) {
        mapComponentRef.current.zoomToTrip(trip, 'collapsed');
      }
    }, 350);
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
    Promise.all(updatedTrips.map(t => TripAPI.saveTrip(t)));
  };

  const isMobileSearchOpen = isSearchOpen;
  const isMobilePoiSmaller = !!selectedPOI;
  const sidebarClasses = `sidebar ${isSidebarCollapsed ? 'collapsed' : ''} ${isMobileSearchOpen ? 'search-maximized' : ''} ${isMobilePoiSmaller && !isSearchOpen ? 'poi-info-smaller' : ''}`;

  const sidebarProps = {
    className: sidebarClasses,
    onTouchStart: (e: React.TouchEvent) => {
      const target = e.target as HTMLElement;
      const contentScrollContainer = target.closest('.content') || target.closest('.trip-editor');
      
      const isToolbar = target.closest('.toolbar') || target.closest('.mobile-drag-handle');
      const isScrollTop = contentScrollContainer && contentScrollContainer.scrollTop === 0;

      if (isToolbar || isScrollTop) {
        touchStartRef.current = {
          y: e.touches[0].clientY,
          isContentEdge: !isToolbar && !!isScrollTop
        };
      }
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (touchStartRef.current === null) return;
      const currentY = e.touches[0].clientY;
      const deltaY = currentY - touchStartRef.current.y;
      // Prevent default scrolling only if we are significantly dragging vertically on the handle
      if (Math.abs(deltaY) > 10) {
        // We do not call preventDefault here directly because React's touchMove is passive by default
      }
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (touchStartRef.current === null) return;
      const { y, isContentEdge } = touchStartRef.current;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaY = touchEndY - y;
      
      if (deltaY > 50) {
        setIsSidebarCollapsed(true);
      } else if (deltaY < -50 && (!isContentEdge || isSidebarCollapsed)) {
        setIsSidebarCollapsed(false);
      } else if (Math.abs(deltaY) < 10) {
        // It was a tap, toggle if it was on the handle itself
        if (isSidebarCollapsed && (e.target as HTMLElement).closest('.mobile-drag-handle')) {
          setIsSidebarCollapsed(false);
        }
      }
      touchStartRef.current = null;
    }
  };

  return (
    <>
      <div className="layout">
      <div {...sidebarProps}>
        <div className="mobile-drag-handle"></div>
        {isPreferencesOpen ? (
          <PreferencesPanel
            onGoBack={() => setIsPreferencesOpen(false)}
            onSetHome={() => mapComponentRef.current?.setHome?.()}
            onZoomHome={() => mapComponentRef.current?.zoomToHome?.()}
          />
        ) : isStatusOpen ? (
          <StatusPanel
            onGoBack={() => setIsStatusOpen(false)}
            trips={trips}
            onUpdateTrips={handleUpdateExternalTrips}
          />
        ) : isAnalyticsOpen ? (
          <>
            <div style={{ display: analyticsSegmentInfo ? 'none' : 'block', height: '100%' }}>
              <AnalyticsPanel
                onGoBack={() => {
                  setAnalyticsSegmentInfo(null);
                  setIsAnalyticsOpen(false);
                }}
                trips={trips}
                onOpenSegmentInfo={(tripId, segmentId) => {
                  setAnalyticsSegmentInfo({ tripId, segmentId });
                }}
                onFocusSegment={(tripId, segmentId) => {
                  const trip = trips.find(t => t.id === tripId);
                  const segment = trip?.segments.find(s => s.id === segmentId);
                  if (!segment) return;
                  if (window.innerWidth <= 768) {
                    mapComponentRef.current?.zoomToSegment(segment, 'collapsed', 'trip');
                    setIsSidebarCollapsed(true);
                  } else {
                    mapComponentRef.current?.zoomToSegment(segment, 'current', 'trip');
                  }
                }}
              />
            </div>
            {analyticsSegmentInfo ? (() => {
              const targetTrip = trips.find(trip => trip.id === analyticsSegmentInfo.tripId);
              if (!targetTrip) return null;
              return (
                <SegmentInfo
                  isReadOnly={isReadOnly}
                  segmentId={analyticsSegmentInfo.segmentId}
                  trip={targetTrip}
                  allTrips={trips}
                  onGoBack={() => setAnalyticsSegmentInfo(null)}
                  onUpdateTrip={(newTrip) => updateTripState(targetTrip.id, newTrip)}
                  hoveredCoordinate={hoveredCoordinate}
                  onHoverCoordinate={setHoveredCoordinate}
                  onZoomToSegment={(seg) => {
                    if (window.innerWidth <= 768) {
                      mapComponentRef.current?.zoomToSegment(seg, 'collapsed', 'trip');
                      setIsSidebarCollapsed(true);
                    } else {
                      mapComponentRef.current?.zoomToSegment(seg, 'current', 'trip');
                    }
                  }}
                />
              );
            })() : null}
          </>
        ) : isSearchOpen ? (
          <SearchPanel 
            onGoBack={() => setIsSearchOpen(false)}
            onResultClick={(result) => {
              if (Array.isArray(result)) {
                    mapComponentRef.current?.flyTo(result[0], result[1], 'open', true, 'poi');
                  } else {
                    mapComponentRef.current?.flyTo(parseFloat(result.lon), parseFloat(result.lat), 'open', true, 'poi');
                const newPoi = {
                  id: `search-${result.osm_type}-${result.osm_id}`,
                  name: result.name || result.display_name.split(',')[0],
                  class: result.class,
                  subclass: result.type,
                  coordinates: [parseFloat(result.lon), parseFloat(result.lat)],
                    properties: { name: result.name || result.display_name.split(',')[0] },
                    ...(result.namedetails || {})
                };
                setSelectedPOI(newPoi);
                setIsSearchOpen(false);
              }
            }}
          />
        ) : selectedPOI ? (
          <POIInfo isReadOnly={isReadOnly}
            poi={selectedPOI}
            trip={selectedTrip}
            onGoBack={handleGoBackPOI}
            onUpdateTrip={(newTrip) => updateTripState(newTrip.id, newTrip)}
            onStartNewTrip={(poi, details) => {
              handleCreateTrip(poi, details);
              setSelectedPOI(null);
            }}
            onAddedToTrip={(wpId) => {
              handleGoBackPOI();
              setHighlightedWaypointId(wpId);
            }}
            selectedWaypointId={selectedWaypointId}
            onAttachToWaypoint={(poi, details) => {
              if (!selectedTrip || !selectedWaypointId) return;
              const newSegments = selectedTrip.segments.map(seg => ({
                ...seg,
                waypoints: seg.waypoints.map(wp => {
                  if (wp.id === selectedWaypointId) {
                    const newName = wp.name || poi.name || details?.name || details?.display_name || '';
                    return {
                      ...wp,
                      name: newName,
                      poi: {
                        id: poi.id || poi.properties?.id || details?.osm_id || `poi_${Date.now()}`,
                        name: poi.name || details?.name || details?.display_name,
                        type: poi.class,
                        subtype: poi.subclass,
                        details: details || {}
                      }
                    };
                  }
                  return wp;
                })
              }));
              updateTripState(selectedTrip.id, { ...selectedTrip, segments: newSegments });
              setSelectedPOI(null); // automatically close POI info and go back to Waypoint info
            }}
          />
        ) : selectedSegmentId && selectedTrip ? (
          <SegmentInfo isReadOnly={isReadOnly} 
            segmentId={selectedSegmentId} 
            trip={selectedTrip} 
            allTrips={trips}
            onGoBack={handleGoBackSegment} 
            onUpdateTrip={(newTrip) => updateTripState(selectedTrip.id, newTrip)}
            hoveredCoordinate={hoveredCoordinate}
            onHoverCoordinate={setHoveredCoordinate}
            onZoomToSegment={(seg) => {
              if (window.innerWidth <= 768) {
                mapComponentRef.current?.zoomToSegment(seg, 'collapsed', 'trip');
                setIsSidebarCollapsed(true);
              } else {
                mapComponentRef.current?.zoomToSegment(seg, 'current', 'trip');
              }
            }}
          />
        ) : selectedWaypointId && selectedTrip ? (
          <WaypointInfo isReadOnly={isReadOnly} 
            waypointId={selectedWaypointId} 
            trip={selectedTrip} 
            onGoBack={handleGoBackWaypoint}
            onUpdateTrip={(newTrip) => updateTripState(selectedTrip.id, newTrip)}
            setHighlightedWaypointId={setHighlightedWaypointId}
            attachingPoiToWaypointId={attachingPoiToWaypointId}
            setAttachingPoiToWaypointId={setAttachingPoiToWaypointId}
            onJumpToWaypoint={(id) => {
              setIsSidebarCollapsed(true);
              setTimeout(() => { mapComponentRef.current?.handleJumpToWaypoint(id, 'collapsed', 'trip'); }, 350);
            }}
          />
        ) : !selectedTrip && isLoadingSharedTrip ? (
          <div className="trip-editor">
            <div className="toolbar"><h2 className="toolbar-title">Loading Shared Trip</h2></div>
            <div className="content">Loading the shared trip…</div>
          </div>
        ) : !selectedTrip ? (
          <TripManager isReadOnly={isReadOnly}
            onToggleReadOnly={() => setIsReadOnly(!isReadOnly)}
            trips={trips}
            onSelectTrip={handleSelectTrip}
            onDeleteTrip={handleDeleteTrip}
              onUploadTrip={handleUploadTrip}
              onReloadTrips={loadTrips}              isTripsLoading={isLoadingTrips}
            hasSyncIssues={Object.keys(tripConflicts).length > 0 || preferenceConflicts.length > 0 || Object.keys(missingTrips).length > 0}
            onOpenConflictResolver={() => setShowConflictResolution(true)}
            unsavedTripIds={unsavedTripIds}              conflictedTripIds={conflictedTripIds}            onSaveAll={handleSaveAllUnsaved}
            onCreateTrip={handleCreateTrip}
            onOpenStatus={() => {
              setIsStatusOpen(true);
              setIsAnalyticsOpen(false);
              setIsPreferencesOpen(false);
              setIsSidebarCollapsed(false);
            }}
            onOpenSettings={() => {
              setIsPreferencesOpen(true);
              setIsStatusOpen(false);
              setIsAnalyticsOpen(false);
              setIsSidebarCollapsed(false);
            }}
            onOpenAnalytics={() => {
              setIsAnalyticsOpen(true);
              setIsStatusOpen(false);
              setIsPreferencesOpen(false);
              setIsSidebarCollapsed(false);
            }}
          />
        ) : (
          <TripEditor isReadOnly={isReadOnly}
            onToggleReadOnly={selectedTrip.metadata?.isSharedTripReference || isViewingSharedTrip ? undefined : () => setIsReadOnly(!isReadOnly)}
            trip={selectedTrip}
            allTrips={trips}
            isSidebarCollapsed={isSidebarCollapsed}
            isSharedTripView={isViewingSharedTrip}
            onSelectTrip={handleSelectTrip}
            onGoBack={handleGoBackTripEditor}
            onSelectSegment={setSelectedSegmentId}
            onSelectWaypoint={setSelectedWaypointId}
            onZoomToTrip={() => {
              setIsSidebarCollapsed(true);
              setTimeout(() => { mapComponentRef.current?.zoomToTrip(selectedTrip, 'collapsed', 'trip'); }, 350);
            }}
            onZoomToSegment={(seg) => {
              setIsSidebarCollapsed(true);
              setTimeout(() => { mapComponentRef.current?.zoomToSegment(seg, 'collapsed', 'trip'); }, 350);
            }}
            onJumpToWaypoint={(id) => {
              setIsSidebarCollapsed(true);
              setTimeout(() => { mapComponentRef.current?.handleJumpToWaypoint(id, 'collapsed', 'trip'); }, 350);
            }}
            availablePersistingServices={persistingManager.getAvailableServices()}
            onPersistOwnedTrip={persistOwnedTrip}
            onSaveSharedTripReference={saveSharedTripReference}
            highlightedWaypointId={highlightedWaypointId}
            onClearHighlight={() => setHighlightedWaypointId(null)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={!!histories[selectedTrip.id]?.past.length}
            canRedo={!!histories[selectedTrip.id]?.future.length}
            onSave={async () => { await handleSave(); }}
            canSave={histories[selectedTrip.id]?.lastSavedStr !== stripMeta(selectedTrip)}
            onUpdateTrip={(newTrip) => updateTripState(selectedTrip.id, newTrip)}
            onWaitingForCoords={(wpId) => {
              setWaitingWaypointId(wpId);
              waitingWaypointIdRef.current = wpId;
            }}
            onRequestSetup={promptSetupWizard}
          />
        )}
      </div>
      {showSetupWizard && <SetupWizard onComplete={handleSetupWizardComplete} onStartBackgroundSync={loadTrips} />}
      <Map isReadOnly={isReadOnly}
        ref={mapComponentRef}
        trips={trips}
        selectedTrip={selectedTrip}
        styleContextSelectedSegment={analyticsStyleSegment}
        waitingWaypointId={waitingWaypointId}
        waitingWaypointIdRef={waitingWaypointIdRef}
        setWaitingWaypointId={setWaitingWaypointId}
        updateTripState={updateTripState}
        handleCoordinateChange={handleCoordinateChange}
        setSelectedWaypointId={setSelectedWaypointId}
        setHighlightedWaypointId={handleSetHighlightedWaypointId}
        selectedSegmentId={selectedSegmentId}
        setSelectedSegmentId={setSelectedSegmentId}
        selectedPOI={selectedPOI}
        onDragStart={() => {
          if (attachingPoiToWaypointId) setAttachingPoiToWaypointId(null);
        }}
        setSelectedPOI={(poi) => {
          if (attachingPoiToWaypointId && poi && selectedTrip) {
            const processAttach = async () => {
              let details = poi.details;
              if (!details && poi.coordinates) {
                try {
                  const [lon, lat] = poi.coordinates;
                  const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=18&accept-language=${navigator.language || 'en'}`);
                  details = await r.json();
                } catch {
                  // ignore
                }
              }
              const newSegments = selectedTrip.segments.map(seg => ({
                ...seg,
                waypoints: seg.waypoints.map(wp => {
                  if (wp.id === attachingPoiToWaypointId) {
                    const resolvedPoiName = resolvePOIName(poi, details);
                    const newName = wp.name || resolvedPoiName || '';
                    return {
                      ...wp,
                      name: newName,
                      poi: {
                        id: poi.id || poi.properties?.id || details?.osm_id || `poi_${Date.now()}`,
                        name: resolvedPoiName,
                        type: poi.class,
                        subtype: poi.subclass,
                        details: details || {}
                      }
                    };
                  }
                  return wp;
                })
              }));
              updateTripState(selectedTrip.id, { ...selectedTrip, segments: newSegments });
              setAttachingPoiToWaypointId(null);
            };
            processAttach();
            return;
          }

          setSelectedPOI(poi);
            if (poi) {
              setIsStatusOpen(false);
              setIsPreferencesOpen(false);
            }
          if (poi && mapComponentRef.current && poi.coordinates) {
             mapComponentRef.current.flyTo(poi.coordinates[0], poi.coordinates[1], 'open', true, 'poi');
          }
          if (poi) setIsSidebarCollapsed(false);
        }}
        hoveredCoordinate={hoveredCoordinate}
        onHoverCoordinate={setHoveredCoordinate}
        onEmptyClick={() => setIsSidebarCollapsed(true)}
        isSidebarCollapsed={isSidebarCollapsed}
        onSearchClick={() => {
          setIsSearchOpen(true);
          setIsStatusOpen(false);
          setIsPreferencesOpen(false);
          setIsSidebarCollapsed(false);
        }}
        onSelectTrip={handleSelectTrip}
      />
    </div>

    <Dialog
      isOpen={showConflictResolution}
      title="Resolve Sync Conflicts"
      onClose={() => setShowConflictResolution(false)}
      actions={
        <>
          <button className="dialog-btn dialog-btn-cancel" onClick={() => setShowConflictResolution(false)} disabled={isAcceptingAllConflicts}>Close</button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleAcceptLatestAndUploadMissing} disabled={isAcceptingAllConflicts || activeConflictSave !== null || uploadingMissingTripId !== null}>
            {isAcceptingAllConflicts ? 'Accepting and uploading all...' : 'Accept latest and upload missing'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto' }}>
        {preferenceConflicts.length > 0 && (
          <section>
            <h4 style={{ margin: '0 0 6px' }}>Preferences</h4>
            {preferenceConflicts.map(version => (
              <div key={version.source} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                <span style={{ flex: 1 }}>{version.source}</span>
                <span style={{ fontSize: '0.85em', color: '#666' }}>{version.preferences.updatedAt ? new Date(version.preferences.updatedAt).toLocaleString() : 'No timestamp'}</span>
                <button className="dialog-btn dialog-btn-primary" onClick={() => handleResolvePreferenceConflict(version)} disabled={isAcceptingAllConflicts || activeConflictSave === 'preferences'}>
                  {activeConflictSave === 'preferences' ? 'Saving...' : 'Accept'}
                </button>
              </div>
            ))}
          </section>
        )}
        {Object.entries(tripConflicts).map(([tripId, versions]) => (
          <section key={tripId}>
            <h4 style={{ margin: '0 0 6px' }}>{versions[0]?.name || 'Unnamed trip'}</h4>
            {versions.map((trip, index) => (
              <div key={`${trip.metadata?._sourceService}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                <span style={{ flex: 1 }}>{trip.metadata?._sourceService || 'Unknown source'}</span>
                <span style={{ fontSize: '0.85em', color: '#666' }}>{trip.updatedAt ? new Date(trip.updatedAt).toLocaleString() : 'No timestamp'}</span>
                <button className="dialog-btn dialog-btn-primary" onClick={() => handleResolveConflict(tripId, trip)} disabled={isAcceptingAllConflicts || activeConflictSave === `trip:${tripId}`}>
                  {activeConflictSave === `trip:${tripId}` ? 'Saving...' : 'Accept'}
                </button>
              </div>
            ))}
          </section>
        ))}
        {Object.entries(missingTrips).length > 0 && (
          <section>
            <h4 style={{ margin: '0 0 6px' }}>Trips missing from a service</h4>
            {Object.entries(missingTrips).map(([tripId, services]) => (
              <div key={tripId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '3px 0', fontSize: '0.9em' }}>
                <span style={{ flex: 1 }}>{trips.find(trip => trip.id === tripId)?.name || tripId}: missing from {services.join(', ')}</span>
                <button className="dialog-btn dialog-btn-primary" onClick={() => handleUploadMissingTrip(tripId)} disabled={isAcceptingAllConflicts || uploadingMissingTripId === tripId}>
                  {uploadingMissingTripId === tripId ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </Dialog>

    {exitingTempTripAlert && <Dialog
      isOpen={true}
      title="Unsaved Trip"
      onClose={() => setExitingTempTripAlert(false)}
      actions={
        <>
          <button className="dialog-btn dialog-btn-cancel" onClick={() => {
             setExitingTempTripAlert(false);
             setSelectedTrip(null);
             setSelectedSegmentId(null);
             setSelectedWaypointId(null);
             setHighlightedWaypointId(null);
             setSelectedPOI(null);
          }}>Discard</button>
          <button className="dialog-btn dialog-btn-primary" onClick={async () => {
             const success = await handleSave();
             if (success) {
               setExitingTempTripAlert(false);
               setSelectedTrip(null);
               setSelectedSegmentId(null);
               setSelectedWaypointId(null);
               setHighlightedWaypointId(null);
               setSelectedPOI(null);
             }
          }}>Save & Exit</button>
        </>
      }
    >
      <p>This new trip has not been saved yet. Would you like to save it or discard it?</p>
    </Dialog>}

    <Dialog
      isOpen={sharedTripError !== null}
      title="Shared Trip"
      onClose={() => setSharedTripError(null)}
      actions={
        <button className="dialog-btn dialog-btn-primary" onClick={() => {
          setSharedTripError(null);
          window.history.replaceState({}, '', import.meta.env.BASE_URL);
          if (persistingManager.getAvailableServices().length === 0) {
            promptSetupWizard();
          }
        }}>
          Go Home
        </button>
      }
    >
      <p style={{ margin: 0 }}>{sharedTripError}</p>
    </Dialog>
    </>
  );
}
