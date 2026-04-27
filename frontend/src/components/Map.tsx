import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import type { Segment, Trip } from '../../../shared/types';
import { Map as MapLibreMap, NavigationControl, GeoJSONSource, Marker, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/Map.css';
// Removed unused route import
import { optimizeSegmentRoute } from '../routing/routeOptimizer';
import { ModeThemes } from '../themes/config';
import * as turf from '@turf/turf';
import { MAP_STYLES, POI_LAYERS, MARKER_HIDE_THRESHOLD } from '../config/mapStyles';
import { getPOIEmoji } from '../utils/poiUtils';


function getRenderGeometry(seg: any) {
    if (seg.transportMode === 'flight' && seg.waypoints && seg.waypoints.length >= 2) {
        let coords: any[] = [];
        for (let i = 0; i < seg.waypoints.length - 1; i++) {
            const w1 = seg.waypoints[i].coordinates;
            const w2 = seg.waypoints[i+1].coordinates;
            if (w1 && w2 && w1.length >= 2 && w2.length >= 2) {
                try {
                    const arc = turf.greatCircle(turf.point(w1), turf.point(w2));
                    const arcCoords = arc.geometry.coordinates;
                    if (coords.length > 0 && arcCoords.length > 0) {
                        coords.push(...arcCoords.slice(1));
                    } else {
                        coords.push(...arcCoords);
                    }
                } catch(e) {
                    if (coords.length > 0) coords.push(w2);
                    else coords.push(w1, w2);
                }
            }
        }
        if (coords.length > 1) {
            return { type: 'LineString', coordinates: coords };
        }
    }
    return seg.geometry;
}

export interface MapRef {
    zoomToTrip: (trip: Trip, targetSidebarState?: 'open' | 'collapsed' | 'current', targetView?: 'trip' | 'poi' | 'manager') => void;
    zoomToSegment: (segment: Segment, targetSidebarState?: 'open' | 'collapsed' | 'current', targetView?: 'trip' | 'poi' | 'manager') => void;
    handleJumpToWaypoint: (waypointId: string, targetSidebarState?: 'open' | 'collapsed' | 'current', targetView?: 'trip' | 'poi' | 'manager') => void;
    flyTo: (lon: number, lat: number, targetSidebarState?: 'open' | 'collapsed' | 'current', onlyIfNotVisible?: boolean, targetView?: 'trip' | 'poi' | 'manager') => void;
    setHome: () => void;
    zoomToHome: () => void;
}

export interface MapProps {
    isReadOnly?: boolean;
    trips: Trip[];
    selectedTrip: Trip | null;
    waitingWaypointId: string | null;
    waitingWaypointIdRef: React.MutableRefObject<string | null>;
    setWaitingWaypointId: (id: string | null) => void;
    updateTripState: (tripId: string, newTrip: Trip, replaceLastHistory?: boolean) => void;
    handleCoordinateChange: (trip: Trip, wpId: string, coords: [number, number]) => Promise<void>;
    setSelectedWaypointId: (id: string | null) => void;
    setHighlightedWaypointId: (id: string | null) => void;
    selectedSegmentId: string | null;
    setSelectedSegmentId: (id: string | null) => void;
    selectedPOI: any | null;
    setSelectedPOI: (poi: any | null) => void;
    hoveredCoordinate: { lon: number; lat: number; ele?: number } | null;
    onHoverCoordinate: (coord: { lon: number; lat: number; ele?: number } | null) => void;
    onSearchClick: () => void;
    onSelectTrip?: (trip: Trip) => void;
    onEmptyClick?: () => void;
    isSidebarCollapsed?: boolean;
}

export const Map = forwardRef<MapRef, MapProps>(({
    isReadOnly = false,
    trips,
    selectedTrip,
    waitingWaypointId,
    waitingWaypointIdRef,
    setWaitingWaypointId,
    updateTripState,
    handleCoordinateChange,
    setSelectedWaypointId,
    setHighlightedWaypointId,
    selectedSegmentId,
    setSelectedSegmentId,
    selectedPOI,
    setSelectedPOI,
    hoveredCoordinate,
    onHoverCoordinate,
    onSearchClick,
    onSelectTrip,
    onEmptyClick,
    isSidebarCollapsed
}, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<{ marker: Marker, wp: any, pref: number }[]>([]);
  const tempMarkerRef = useRef<Marker | null>(null);
  const hoverCoordMarkerRef = useRef<Marker | null>(null);
  const selectedPoiMarkerRef = useRef<Marker | null>(null);
  const ghostMarkerRef = useRef<Marker | null>(null);
  const ghostMarkerDataRef = useRef<{ segmentId: string, originalWaypoints: any[], insertIndex: number } | null>(null);
  const isDraggingGhostRef = useRef(false);
  const isHoveringWaypointRef = useRef(false);
  const layerSelectorRef = useRef<HTMLDivElement>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeMapStyle, setActiveMapStyle] = useState<string>(() => {
    return localStorage.getItem('activeMapStyle') || 'openfreemap';
  });
  const [showLayerSelector, setShowLayerSelector] = useState(false);
  const [showHiddenSegments, setShowHiddenSegments] = useState<boolean>(() => {
    return localStorage.getItem('showHiddenSegments') === 'true';
  });
  const [mapStyleLoadedTime, setMapStyleLoadedTime] = useState(Date.now());
  const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, name: string, mode: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, lngLat: [number, number] } | null>(null);

  useEffect(() => {
    localStorage.setItem('activeMapStyle', activeMapStyle);
  }, [activeMapStyle]);

  useEffect(() => {
    localStorage.setItem('showHiddenSegments', String(showHiddenSegments));
  }, [showHiddenSegments]);

const hotkeyRefs = useRef({ isReadOnly, selectedTrip, updateTripState, handleCoordinateChange, setSelectedPOI, trips, onSelectTrip, selectedPOI, onEmptyClick });

  useEffect(() => {
    if (!mapRef.current) return;

    if (hoveredCoordinate) {
      if (!hoverCoordMarkerRef.current) {
        const el = document.createElement('div');
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.backgroundColor = 'red';
        el.style.border = '2px solid white';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
        el.style.pointerEvents = 'none';

        hoverCoordMarkerRef.current = new Marker({ element: el });
      }
      hoverCoordMarkerRef.current.setLngLat([hoveredCoordinate.lon, hoveredCoordinate.lat]).addTo(mapRef.current);
    } else {
      if (hoverCoordMarkerRef.current) {
        hoverCoordMarkerRef.current.remove();
        hoverCoordMarkerRef.current = null;
      }
    }
  }, [hoveredCoordinate]);

  useEffect(() => {
    waitingWaypointIdRef.current = waitingWaypointId;
  }, [waitingWaypointId, waitingWaypointIdRef]);

  useEffect(() => {
      hotkeyRefs.current = { isReadOnly, selectedTrip, updateTripState, handleCoordinateChange, setSelectedPOI, trips, onSelectTrip, selectedPOI, onEmptyClick };
    }, [isReadOnly, selectedTrip, updateTripState, handleCoordinateChange, setSelectedPOI, trips, onSelectTrip, selectedPOI, onEmptyClick]);
// Require drag targeting cleanly. E.g. touch only timeline-col or drag-handle.
  const getPadding = (targetSidebarState: 'open' | 'collapsed' | 'current' = 'current', targetView?: 'trip' | 'poi' | 'manager') => {
    if (window.innerWidth > 768) {
      return { top: 50, bottom: 50, left: 50, right: 50 };
    }
    // Mobile height offset calculation.
    let heightOffset = 64; // Collapsed height

    const shouldBeOpen = targetSidebarState === 'open'
      ? true
      : targetSidebarState === 'collapsed'
        ? false
        : !isSidebarCollapsed;

    if (shouldBeOpen) {
        if (targetView === 'trip') {
            heightOffset = Math.min(window.innerHeight * 0.70 + 30, window.innerHeight - 100);
        } else if (targetView === 'poi') {
            heightOffset = Math.min(window.innerHeight * 0.50 + 30, window.innerHeight - 100);
        } else if (targetView === 'manager') {
            heightOffset = 150;
        } else {
            const isEditingPoint = !!hotkeyRefs.current.selectedTrip;
            if (isEditingPoint) {
                heightOffset = Math.min(window.innerHeight * 0.70 + 30, window.innerHeight - 100);
            } else if (hotkeyRefs.current.selectedPOI) {
                heightOffset = Math.min(window.innerHeight * 0.50 + 30, window.innerHeight - 100);
            } else {
                heightOffset = 150;
            }
        }
    }
    return { top: 50, bottom: heightOffset, left: 50, right: 50 };
  };

  const zoomToTrip = (trip: Trip, targetSidebarState: 'open' | 'collapsed' | 'current' = 'current', targetView?: 'trip' | 'poi' | 'manager') => {
    if (!mapRef.current) return;

    // Find waypoint and neighbors
    const allWps: { id: string, coordinates: [number, number] }[] = [];
    trip.segments.forEach(seg => {
      if (seg.isHidden && !showHiddenSegments) return;
      seg.waypoints.forEach(wp => {
        if (wp.coordinates && wp.coordinates.length === 2) {
          if (allWps.length === 0 || allWps[allWps.length - 1].id !== wp.id) {
            allWps.push({ id: wp.id, coordinates: wp.coordinates as [number, number] });
          }
        }
      });
      if (seg.geometry && seg.geometry.coordinates) {
          seg.geometry.coordinates.forEach(coord => {
              allWps.push({ id: 'geom', coordinates: coord as [number, number] });
          });
      }
    });

    if (allWps.length === 0) return;

    const bounds = new LngLatBounds(allWps[0].coordinates, allWps[0].coordinates);
    allWps.forEach(wp => bounds.extend(wp.coordinates));

    const paddingLayer = getPadding(targetSidebarState, targetView);

    requestAnimationFrame(() => {
      if (!mapRef.current) return;
      const camera = mapRef.current.cameraForBounds(bounds, { padding: paddingLayer });
      if (camera) {
        mapRef.current.flyTo({
          ...camera,
          padding: paddingLayer,
          essential: true,
          duration: 1200
        });
      }
    });
  };

  const zoomToSegment = (seg: Segment, targetSidebarState: 'open' | 'collapsed' | 'current' = 'current', targetView?: 'trip' | 'poi' | 'manager') => {
    if (!mapRef.current) return;

    const allWps: { id: string, coordinates: [number, number] }[] = [];
    seg.waypoints.forEach(wp => {
      if (wp.coordinates && wp.coordinates.length === 2) {
        if (allWps.length === 0 || allWps[allWps.length - 1].id !== wp.id) {
          allWps.push({ id: wp.id, coordinates: wp.coordinates as [number, number] });
        }
      }
    });
    if (seg.geometry && seg.geometry.coordinates) {
        seg.geometry.coordinates.forEach(coord => {
            allWps.push({ id: 'geom', coordinates: coord as [number, number] });
        });
    }

    if (allWps.length === 0) return;

    const bounds = new LngLatBounds(allWps[0].coordinates, allWps[0].coordinates);
    allWps.forEach(wp => bounds.extend(wp.coordinates));

    requestAnimationFrame(() => {
      if (!mapRef.current) return;
      const targetPadding = getPadding(targetSidebarState, targetView);
      const camera = mapRef.current.cameraForBounds(bounds, { padding: targetPadding });
      if (camera) {
        mapRef.current.flyTo({
          ...camera,
          padding: targetPadding,
          essential: true,
          duration: 1200
        });
      }
    });
  };

const handleJumpToWaypoint = (waypointId: string, targetSidebarState: 'open' | 'collapsed' | 'current' = 'current', targetView?: 'trip' | 'poi' | 'manager') => {
    if (!selectedTrip || !mapRef.current) return;

    // Find waypoint and neighbors
    const allWps: { id: string, coordinates: [number, number] }[] = [];
    selectedTrip.segments.forEach(seg => {
      seg.waypoints.forEach(wp => {
        if (wp.coordinates && wp.coordinates.length === 2) {
          if (allWps.length === 0 || allWps[allWps.length - 1].id !== wp.id) {
            allWps.push({ id: wp.id, coordinates: wp.coordinates as [number, number] });
          }
        }
      });
    });

    const wpIndex = allWps.findIndex(wp => wp.id === waypointId);
    if (wpIndex === -1) return;

    const targetCoord = allWps[wpIndex].coordinates;
    const bounds = new LngLatBounds(targetCoord, targetCoord);

    // Make the bounds symmetrical around the target so centering stays exact 
    const extendSymmetrically = (coord: [number, number]) => {
      const dLng = coord[0] - targetCoord[0];
      const dLat = coord[1] - targetCoord[1];
      bounds.extend([targetCoord[0] + dLng, targetCoord[1] + dLat]);
      bounds.extend([targetCoord[0] - dLng, targetCoord[1] - dLat]);
    };

    if (wpIndex > 0) extendSymmetrically(allWps[wpIndex - 1].coordinates);
    if (wpIndex < allWps.length - 1) extendSymmetrically(allWps[wpIndex + 1].coordinates);

    requestAnimationFrame(() => {
      if (!mapRef.current) return;
      const targetPadding = getPadding(targetSidebarState, targetView);
      const camera = mapRef.current.cameraForBounds(bounds, { padding: targetPadding });
      if (camera) {
        mapRef.current.flyTo({
          ...camera,
          center: targetCoord,
          zoom: Math.min(camera.zoom || 15, 15),
          padding: targetPadding,
          duration: 1200,
          essential: true
        });
      }
    });
  };

  const flyTo = (lon: number, lat: number, targetSidebarState: 'open' | 'collapsed' | 'current' = 'current', onlyIfNotVisible: boolean = false, targetView?: 'trip' | 'poi' | 'manager') => {
    if (!mapRef.current) return;

    const padding = getPadding(targetSidebarState, targetView);

    if (onlyIfNotVisible && window.innerWidth > 768) {
      const container = mapRef.current.getContainer();
      const rect = container.getBoundingClientRect();
      const px = mapRef.current.project([lon, lat]);

      const isVisible =
        px.x >= padding.left &&
        px.x <= (rect.width - padding.right) &&
        px.y >= padding.top &&
        px.y <= (rect.height - padding.bottom);

      if (isVisible) return;
    }

    mapRef.current.flyTo({
      center: [lon, lat],
      zoom: 14,
      padding,
      essential: true
    });
  };

  const setHome = () => {
    if (!mapRef.current) return;
    const center = mapRef.current.getCenter();
    localStorage.setItem('homeMapPosition', JSON.stringify({ center: [center.lng, center.lat], zoom: mapRef.current.getZoom() }));
  };

  const zoomToHome = () => {
    if (!mapRef.current) return;
    const homeRaw = localStorage.getItem('homeMapPosition');
    if (homeRaw) {
      try {
        const home = JSON.parse(homeRaw);
        mapRef.current.flyTo({ center: home.center, zoom: home.zoom, duration: 1200, bearing: 0, pitch: 0 });
      } catch(e) {}
    }
  };

  useImperativeHandle(ref, () => ({
    zoomToTrip,
    zoomToSegment,
    handleJumpToWaypoint,
    flyTo,
    setHome,
    zoomToHome
  }));

  useEffect(() => {
    if (!mapContainer.current) return;
    if (mapRef.current) return;

    let initCenter: [number, number] = [11.3933, 47.2692];
    let initZoom = 9;
    const homeRaw = localStorage.getItem('homeMapPosition');
    if (homeRaw) {
      try {
        const home = JSON.parse(homeRaw);
        initCenter = home.center;
        initZoom = home.zoom;
      } catch(e) {}
    }

    mapRef.current = new MapLibreMap({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty', // Free basemap
      center: initCenter,
      zoom: initZoom
    });
    mapRef.current.addControl(new NavigationControl({}), 'top-right');

    mapRef.current.on('styleimagemissing', (e) => {
      const id = e.id;
      
      let emoji: string | null = null;
      if (id.startsWith('poi-')) {
        const parts = id.split('-');
        const cls = parts[1];
        const sub = parts[2];
          // Pass a dummy name string "sprite" so getPOIEmoji understands 
          // this is not a nameless POI evaluation, but a generic icon request
          emoji = getPOIEmoji(cls, sub, 'sprite');
        }

        if (emoji) {
          const size = 32;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
        if (ctx) {
          // Draw subtle halo circle
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 10, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fill();
          
          // Draw emoji
          ctx.font = '16px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(emoji, size / 2, size / 2 + 1);

          const imgData = ctx.getImageData(0, 0, size, size);
          mapRef.current?.addImage(id, { width: size, height: size, data: new Uint8Array(imgData.data) }, { pixelRatio: 1.5 });
          return;
        }
      }

      // Fallback dot
      const size = 16;
      const data = new Uint8Array(size * size * 4);
      // Create a transparent circle with a border
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - size / 2;
          const dy = y - size / 2;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const i = (y * size + x) * 4;
          if (dist < 3) { // inner dot
            data[i + 0] = 50;
            data[i + 1] = 120;
            data[i + 2] = 200;
            data[i + 3] = 255;
          } else if (dist < 5) { // white halo
            data[i + 0] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = 255;
          } else { // transparent
            data[i + 3] = 0;
          }
        }
      }
      mapRef.current?.addImage(id, { width: size, height: size, data }, { pixelRatio: 2 });
    });

    mapRef.current.on('style.load', () => {
      setMapStyleLoadedTime(Date.now() + Math.random());
    });
    mapRef.current.on('styledata', () => {
      if (mapRef.current && (!mapRef.current.getSource('route-source') || !mapRef.current.getLayer('route-layer'))) {
          setMapStyleLoadedTime(Date.now() + Math.random());
      }
    });
    mapRef.current.on('load', () => {
      if (!mapRef.current) return;

        let longPressTimer: ReturnType<typeof setTimeout> | null = null;
        let touchStartPt: { x: number; y: number } | null = null;

        mapRef.current.on('touchstart', (e) => {
          if (e.originalEvent.touches.length > 1) return;
          if (!hotkeyRefs.current.selectedTrip) return;
          
          touchStartPt = e.point;
          
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            if (hotkeyRefs.current.isReadOnly) return;
            const touch = e.originalEvent.touches[0];
            setContextMenu({ x: touch.clientX, y: touch.clientY, lngLat: [e.lngLat.lng, e.lngLat.lat] });
          }, 600);
        });

        mapRef.current.on('touchmove', (e) => {
          if (longPressTimer && touchStartPt) {
            const dx = e.point.x - touchStartPt.x;
            const dy = e.point.y - touchStartPt.y;
            if (dx * dx + dy * dy > 100) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
          }
        });

        const cancelLongPress = () => {
          if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
          }
        };

        mapRef.current.on('touchend', cancelLongPress);
        mapRef.current.on('touchcancel', cancelLongPress);

        mapRef.current.on('contextmenu', (e) => {
          e.preventDefault();
          if (hotkeyRefs.current.isReadOnly || !hotkeyRefs.current.selectedTrip) return;
          setContextMenu({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, lngLat: [e.lngLat.lng, e.lngLat.lat] });
        });
        mapRef.current.on('dragstart', () => setContextMenu(null));
        mapRef.current.on('movestart', () => setContextMenu(null));
        // Ghost marker logic
        mapRef.current.on('mousemove', (e) => {
          if (isDraggingGhostRef.current) return;
          if (isHoveringWaypointRef.current) return;

          let features: any[] = [];
          let poiFeatures: any[] = [];
          try {
            if (mapRef.current?.getLayer('route-layer')) {
              features = mapRef.current.queryRenderedFeatures(e.point, { layers: ['route-layer'] }) || [];
            }
            const allFeatures = mapRef.current?.queryRenderedFeatures(e.point) || [];
            poiFeatures = allFeatures.filter((f: any) =>
              f.layer &&
              (f.layer.id.includes('poi') || f.layer.id.includes('mountain_peak') || f.layer.id.includes('water_name') || f.layer.id.includes('place_'))
            );
          } catch (err) {
            // Ignore transient map state errors during tile switching
          }

          if (features.length > 0) {
            const feature = features[0];
            const segId = feature.properties.segmentId;
            let segInfo: any;
            let tripName = '';
            
            if (hotkeyRefs.current.selectedTrip) {
              segInfo = hotkeyRefs.current.selectedTrip.segments.find((s: any) => s.id === segId);
            } else if (hotkeyRefs.current.trips) {
              const trip = hotkeyRefs.current.trips.find(t => t.segments.some(s => s.id === segId));
              if (trip) {
                tripName = trip.name;
                segInfo = trip.segments.find(s => s.id === segId);
              }
            }
            
            mapRef.current!.getCanvas().style.cursor = 'pointer';
            setHoverInfo({
              x: e.originalEvent.clientX,
              y: e.originalEvent.clientY,
              name: tripName ? `${tripName} - ${segInfo?.name || ''}` : segInfo?.name || '',
              mode: feature.properties.mode
            });
            
            if (hotkeyRefs.current.selectedTrip && segInfo && segInfo.geometry && segInfo.geometry.coordinates.length > 1) {
              const line = turf.lineString(segInfo.geometry.coordinates as [number, number][]);
              const mousePoint = turf.point([e.lngLat.lng, e.lngLat.lat]);
              const snapped = turf.nearestPointOnLine(line, mousePoint);
              
              if (onHoverCoordinate && snapped && snapped.geometry) {
                const snappedCoords = snapped.geometry.coordinates;
                const origCoords = segInfo.geometry.coordinates;
                // Find index of nearest original coord to get elevation
                let minIdx = 0;
                let minDist = Infinity;
                for (let i = 0; i < origCoords.length; i++) {
                  const dist = Math.pow(origCoords[i][0] - snappedCoords[0], 2) + Math.pow(origCoords[i][1] - snappedCoords[1], 2);
                  if (dist < minDist) {
                    minDist = dist;
                    minIdx = i;
                  }
                }
                onHoverCoordinate({
                  lon: snappedCoords[0],
                  lat: snappedCoords[1],
                  ele: origCoords[minIdx][2]
                });
              }

              let snappedDist = snapped.properties?.location as number;
              if (snappedDist === undefined) {
                  snappedDist = turf.length(turf.lineSlice(turf.point(line.geometry.coordinates[0] as [number, number]), snapped, line));
              }
              
              let insertIndex = 1;
              for (let i = 0; i < segInfo.waypoints.length - 1; i++) {
                  const wpA = segInfo.waypoints[i];
                  const wpB = segInfo.waypoints[i+1];
                  if (!wpA.coordinates || !wpB.coordinates || wpA.coordinates.length < 2 || wpB.coordinates.length < 2) continue;
                  
                  const pA = turf.nearestPointOnLine(line, turf.point(wpA.coordinates as [number, number]));
                  const pB = turf.nearestPointOnLine(line, turf.point(wpB.coordinates as [number, number]));
                  
                  let dA = pA.properties?.location as number ?? turf.length(turf.lineSlice(turf.point(line.geometry.coordinates[0] as [number, number]), pA, line));
                  let dB = pB.properties?.location as number ?? turf.length(turf.lineSlice(turf.point(line.geometry.coordinates[0] as [number, number]), pB, line));
                  
                  if (dA > dB) {
                      const temp = dA;
                      dA = dB;
                      dB = temp;
                  }
                  
                  if (snappedDist >= dA && snappedDist <= dB) {
                      insertIndex = i + 1;
                      break;
                  }
              }
              
              ghostMarkerDataRef.current = {
                  segmentId: segId,
                  originalWaypoints: [],
                  insertIndex
              };
              
              if (!ghostMarkerRef.current) {
                const el = document.createElement('div');
                el.style.width = '12px';
                el.style.height = '12px';
                el.style.backgroundColor = 'red';
                el.style.border = '2px solid white';
                el.style.borderRadius = '50%';
                el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
                el.style.cursor = 'pointer';
                
                ghostMarkerRef.current = new Marker({ element: el, draggable: !isReadOnly })
                  .setLngLat(snapped.geometry!.coordinates as [number, number])
                  .addTo(mapRef.current!);
                  
                ghostMarkerRef.current.on('dragstart', () => {
                  isDraggingGhostRef.current = true;
                  setHoverInfo(null);
                });
                
                ghostMarkerRef.current.on('dragend', () => {
                  isDraggingGhostRef.current = false;
                  if (ghostMarkerRef.current && ghostMarkerDataRef.current) {
                     const wpCoords = ghostMarkerRef.current.getLngLat();
                     const { segmentId, insertIndex } = ghostMarkerDataRef.current;
                     const targetTrip = hotkeyRefs.current.selectedTrip!;
                     
                     const newSegments = [...targetTrip.segments];
                     const segIndex = newSegments.findIndex(s => s.id === segmentId);
                     if (segIndex > -1) {
                        const newWaypoint = {
                            id: 'wp-' + Date.now(),
                            name: '',
                            coordinates: [wpCoords.lng, wpCoords.lat] as [number, number],
                            importance: 'hidden' as 'hidden'
                        };
                        const targetSeg = newSegments[segIndex];
                        const newWps = [...targetSeg.waypoints];
                        newWps.splice(insertIndex, 0, newWaypoint);
                        newSegments[segIndex] = { ...targetSeg, waypoints: newWps };
                        
                        hotkeyRefs.current.updateTripState(targetTrip.id, { ...targetTrip, segments: newSegments });
                        
                        if (targetSeg.source === 'router') {

                                const validCoords = newSegments[segIndex].waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map((w: any) => w.coordinates as [number, number]);
                                if (validCoords.length >= 2) {
                                    optimizeSegmentRoute(newSegments[segIndex], targetSeg).then((geom: any) => {
                                        newSegments[segIndex] = { ...newSegments[segIndex], geometry: geom };
                                        hotkeyRefs.current.updateTripState(targetTrip.id, { ...targetTrip, segments: [...newSegments] }, true);
                                    });
                                }
                        }
                     }
                  }
                  
                  if (ghostMarkerRef.current) {
                     ghostMarkerRef.current.getElement().style.display = 'none';
                  }
                });
              } else {
                ghostMarkerRef.current.getElement().style.display = 'block';
                ghostMarkerRef.current.setLngLat(snapped.geometry!.coordinates as [number, number]);
              }
              
            }
          } else if (poiFeatures.length > 0) {
            mapRef.current!.getCanvas().style.cursor = 'pointer';
            setHoverInfo(null);
            if (onHoverCoordinate) {
              onHoverCoordinate(null);
            }

            if (ghostMarkerRef.current && !isDraggingGhostRef.current) {
                ghostMarkerRef.current.getElement().style.display = 'none';
            }
          } else {
            setHoverInfo(null);
            mapRef.current!.getCanvas().style.cursor = '';
            
            if (ghostMarkerRef.current && !isDraggingGhostRef.current) {
                const markerEl = ghostMarkerRef.current.getElement();
                if (e.originalEvent.target !== markerEl && !markerEl.contains(e.originalEvent.target as Node)) {
                    markerEl.style.display = 'none';
                }
            }
            if (onHoverCoordinate) {
              onHoverCoordinate(null);
            }
          }
        });

        mapRef.current.on('mouseout', () => {
          if (onHoverCoordinate) {
            onHoverCoordinate(null);
          }
        });

        // Add map click handler for placing waypoints
        mapRef.current.on('click', async (e) => {
          setContextMenu(null);

          if (!hotkeyRefs.current.selectedTrip) {
            try {
              const routeFeatures = mapRef.current?.queryRenderedFeatures(e.point, { layers: ['route-layer'] }) || [];
              if (routeFeatures.length > 0) {
                const clickedSegId = routeFeatures[0].properties?.segmentId;
                const trip = hotkeyRefs.current.trips.find(t => t.segments.some(s => s.id === clickedSegId));
                if (trip && hotkeyRefs.current.onSelectTrip) {
                  setHoverInfo(null);
                  hotkeyRefs.current.onSelectTrip(trip);
                }
                return;
              }
            } catch (err) {}
          }

          let poiCoord: [number, number] | null = null;
          let poiData: any = null;
          try {
            const allFeatures = mapRef.current?.queryRenderedFeatures(e.point) || [];
            const poiFeatures = allFeatures.filter((f: any) =>
              f.layer &&
              (f.layer.id.includes('poi') || f.layer.id.includes('mountain_peak') || f.layer.id.includes('water_name') || f.layer.id.includes('place_'))
            );
            if (poiFeatures.length > 0) {
              const poi = poiFeatures[0];
              if (poi.geometry.type === 'Point') {
                poiCoord = poi.geometry.coordinates as [number, number];
              } else {
                poiCoord = [e.lngLat.lng, e.lngLat.lat];
              }
              poiData = { ...poi.properties, coordinates: poiCoord, id: poi.id || `poi` };
            }
          } catch (err) {}

          if (waitingWaypointIdRef.current && hotkeyRefs.current.selectedTrip) {
            const coords: [number, number] = poiCoord || [e.lngLat.lng, e.lngLat.lat];
            const wpId = waitingWaypointIdRef.current;

            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }

            setWaitingWaypointId(null);
            waitingWaypointIdRef.current = null;

            let fetchedDetails: any = null;
            if (poiData) {
              try {
                const acceptLanguage = navigator.language || 'en';
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${coords[1]}&lon=${coords[0]}&format=jsonv2&zoom=18&accept-language=${acceptLanguage}`);
                fetchedDetails = await r.json();
              } catch (e) {}
            }

            const currentTrip = hotkeyRefs.current.selectedTrip;
            const newSegments = [...currentTrip.segments];
            let changed = false;

            for (let i = 0; i < newSegments.length; i++) {
              const seg = { ...newSegments[i] };
              const wpIdx = seg.waypoints.findIndex(w => w.id === wpId);
              if (wpIdx > -1) {
                seg.waypoints = seg.waypoints.map(w => {
                  if (w.id === wpId) {
                    const newWp: any = { ...w, coordinates: coords };
                    if (poiData) {
                      newWp.name = poiData.name || fetchedDetails?.name || fetchedDetails?.display_name || 'POI';
                      newWp.poi = {
                        id: poiData.id || fetchedDetails?.osm_id || `poi-${Date.now()}`,
                        name: poiData.name || fetchedDetails?.name || fetchedDetails?.display_name || 'POI',
                        type: poiData.class || poiData.type,
                        details: fetchedDetails || poiData
                      };
                      newWp.icon = w.icon;
                    }
                    return newWp;
                  }
                  return w;
                });

                if (seg.source === 'router') {
                    const validCoords = seg.waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map(w => w.coordinates as [number, number]);
                    if (validCoords.length >= 2) {
                       seg.geometry = await optimizeSegmentRoute(seg, currentTrip.segments[i]) as any;
                    }
                }
                newSegments[i] = seg;
                changed = true;
              }
            }

            if (changed) {
              hotkeyRefs.current.updateTripState(currentTrip.id, { ...currentTrip, segments: newSegments });
            }
          } else if (poiData) {
            hotkeyRefs.current.setSelectedPOI(poiData);
          } else {
            hotkeyRefs.current.setSelectedPOI(null);
            if (hotkeyRefs.current.onEmptyClick) {
              hotkeyRefs.current.onEmptyClick();
            }
          }
        });

        setMapLoaded(true);
      });

      return () => {
         mapRef.current?.remove();
         mapRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (mapRef.current) {
        mapRef.current.getCanvas().style.cursor = waitingWaypointId ? 'crosshair' : '';
      }
    }, [waitingWaypointId, mapLoaded]);

    useEffect(() => {
      if (mapLoaded && mapRef.current) {
        if (!mapRef.current.getSource('route-source') || !mapRef.current.getLayer('route-layer')) {
          try {
            if (!mapRef.current.getSource('route-source')) {
              mapRef.current.addSource('route-source', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
              });
            }
            if (!mapRef.current.getLayer('route-layer')) {
              mapRef.current.addLayer({
                id: 'route-layer',
                type: 'line',
                source: 'route-source',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': ['coalesce', ['get', 'opacity'], 1.0] }
              });
            }

            // Inject custom POI layers based on the selected map style's available sources
            // Check if openmaptiles source exists (usually present in openfreemap style)
            if (mapRef.current.getSource('openmaptiles')) {
              POI_LAYERS.forEach(layer => {
                if (!mapRef.current!.getLayer(layer.id)) {
                  // Add POI layers, preferably below route-layer if it exists so route is on top
                  try {
                    mapRef.current!.addLayer(layer);
                  } catch (err) {
                    console.warn(`Could not add POI layer ${layer.id}`, err);
                  }
                }
              });
            }

          } catch (e) {
            console.warn('Triplo Map Error: Could not add layer', e);
          }
        }

        if (mapRef.current.getSource('route-source')) {
          const source = mapRef.current.getSource('route-source') as GeoJSONSource;

        // Cleanup old markers
        markersRef.current.forEach(m => m.marker.remove());
        markersRef.current = [];

      if (!selectedTrip) {
        const allFeatures: GeoJSON.Feature[] = [];
        trips.forEach(trip => {
           trip.segments.forEach(seg => {
             if (seg.isHidden && !showHiddenSegments) return;
             allFeatures.push({
               type: 'Feature',
               properties: { segmentId: seg.id, mode: seg.transportMode, color: seg.customColor || ModeThemes[seg.transportMode]?.color || '#007bff' },
               geometry: getRenderGeometry(seg) as any
             });
           });
        });
        source.setData({
          type: 'FeatureCollection',
          features: allFeatures
        });
      } else {
        const features: GeoJSON.Feature[] = selectedTrip.segments
          .filter(seg => !seg.isHidden || showHiddenSegments)
          .map(seg => {
            let opacity = 1.0;
            if (selectedSegmentId && selectedSegmentId !== seg.id) {
              opacity = 0.4;
            }
            return {
              type: 'Feature',
              properties: { 
                segmentId: seg.id, 
                mode: seg.transportMode, 
                color: seg.customColor || ModeThemes[seg.transportMode]?.color || '#007bff',
                opacity
              },
              geometry: getRenderGeometry(seg) as any
            };
          });
        source.setData({
          type: 'FeatureCollection',
          features
        });

        // Add markers
        selectedTrip.segments.forEach((seg, segIndex) => {
          if (seg.isHidden && !showHiddenSegments) return;
          const currSegColor = seg.customColor || ModeThemes[seg.transportMode]?.color || '#007bff';
          seg.waypoints.forEach((wp, wpIndex) => {
            if (!wp.coordinates || wp.coordinates.length < 2) return;
            const isLastInSeg = wpIndex === seg.waypoints.length - 1;
            const isLastSegment = segIndex === selectedTrip.segments.length - 1;

            if (isLastInSeg && !isLastSegment) {
              return; // Border waypoints take the color of the segment starting at that waypoint (the next one)
            }

            const isBordering = wpIndex === 0 && segIndex > 0;
            let pref = 3;
            if (wpIndex === 0 && segIndex === 0) pref = 0;
            else if (isLastSegment && wpIndex === seg.waypoints.length - 1) pref = 0;
            else if (wp.icon) pref = 1;
            else if (isBordering) pref = 2;

            const el = document.createElement('div');
              const isWaypointInSelectedSegment = selectedSegmentId ? selectedTrip.segments.find(s => s.id === selectedSegmentId)?.waypoints.some(w => w.id === wp.id) : true;

              if (wp.icon) {
              // Classic map pin with Material Icon
              el.style.width = '32px';
              el.style.height = '32px';
              el.className = 'custom-map-marker pin-marker';
              el.innerHTML = `
                <svg viewBox="0 0 24 24" width="32" height="32" xmlns="http://www.w3.org/2000/svg" style="display: block; overflow: visible;">
                  <path d="M12 4C8.13 4 5 7.13 5 11c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="${currSegColor}" stroke="white" stroke-width="1.5"/>
                  <circle cx="12" cy="11" r="6.5" fill="white"/>
                </svg>
                <span class="material-symbols-rounded" style="position: absolute; top: 46%; left: 50%; transform: translate(-50%, -50%); font-size: 13px; color: ${currSegColor}; pointer-events: none;">${wp.icon}</span>
              `;
              el.style.display = 'block';
              el.style.cursor = 'pointer';
              el.style.position = 'absolute';
              // add a drop shadow to the SVG path via CSS
              el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))';
            } else {
              el.className = 'custom-map-marker dot-marker';
              el.style.width = '14px';
              el.style.height = '14px';
              el.style.borderRadius = '50%';
              
              const prevSegColor = isBordering ? (selectedTrip.segments[segIndex - 1].customColor || ModeThemes[selectedTrip.segments[segIndex - 1].transportMode]?.color || '#007bff') : currSegColor;
              const backgroundStyle = isBordering 
                ? `linear-gradient(to bottom, ${prevSegColor} 50%, ${currSegColor} 50%)`
                : currSegColor;
                
              el.style.background = backgroundStyle;
              el.style.border = '2px solid white';
              el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
              el.style.display = 'flex';
              el.style.alignItems = 'center';
              el.style.justifyContent = 'center';
              el.style.cursor = 'pointer';
            }
            
            el.addEventListener('mouseenter', (e) => {
              isHoveringWaypointRef.current = true;
              setHoverInfo({
                x: e.clientX,
                y: e.clientY,
                name: wp.name || 'Unnamed Point',
                mode: 'Waypoint'
              });
              if (ghostMarkerRef.current && !isDraggingGhostRef.current) {
                 ghostMarkerRef.current.getElement().style.display = 'none';
              }
            });
            
            el.addEventListener('mouseleave', () => {
              isHoveringWaypointRef.current = false;
              setHoverInfo(null);
            });


            const marker = new Marker({ element: el, draggable: !isReadOnly, anchor: wp.icon ? 'bottom' : 'center' })
              .setLngLat(wp.coordinates as [number, number])
              .addTo(mapRef.current!);

            if (selectedSegmentId && !isWaypointInSelectedSegment) {
              marker.getElement().classList.add('faded-marker');
            } else if (selectedSegmentId) {
              marker.getElement().classList.remove('faded-marker');
            }

            marker.on('dragstart', () => {
              setHoverInfo(null);
            });

            marker.on('dragend', () => {
              const lngLat = marker.getLngLat();
              const coords: [number, number] = [lngLat.lng, lngLat.lat];
              if (hotkeyRefs.current.selectedTrip) {
                hotkeyRefs.current.handleCoordinateChange(hotkeyRefs.current.selectedTrip, wp.id, coords);
              }
            });

            marker.getElement().addEventListener('click', async (e) => {
              e.stopPropagation();

              if (waitingWaypointIdRef.current && hotkeyRefs.current.selectedTrip) {
                const wpId = waitingWaypointIdRef.current;
                if (wpId === wp.id) return; // Prevent clicking itself
                
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }

                setWaitingWaypointId(null);
                waitingWaypointIdRef.current = null;

                const currentTrip = hotkeyRefs.current.selectedTrip;
                const newSegments = [...currentTrip.segments];
                let changed = false;

                for (let i = 0; i < newSegments.length; i++) {
                  const seg = { ...newSegments[i] };
                  const wpIdx = seg.waypoints.findIndex(w => w.id === wpId);
                  if (wpIdx > -1) {
                    seg.waypoints = seg.waypoints.map(w => {
                      if (w.id === wpId) {
                        return {
                          ...w,
                          coordinates: wp.coordinates,
                          name: wp.name || w.name,
                          icon: wp.icon || w.icon,
                          ...(wp.poi ? { poi: wp.poi } : {})
                        };
                      }
                      return w;
                    });
                    
                    if (seg.source === 'router') {
                        const validCoords = seg.waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map(w => w.coordinates as [number, number]);
                        if (validCoords.length >= 2) {
                           seg.geometry = await optimizeSegmentRoute(seg, currentTrip.segments[i]) as any;
                        }
                    }
                    newSegments[i] = seg;
                    changed = true;
                  }
                }

                if (changed) {
                  hotkeyRefs.current.updateTripState(currentTrip.id, { ...currentTrip, segments: newSegments });
                }
                return;
              }

              if (e.ctrlKey || e.metaKey) {
                setSelectedWaypointId(wp.id);
                setHighlightedWaypointId(null);
              } else {
                setHighlightedWaypointId(null);
                setTimeout(() => setHighlightedWaypointId(wp.id), 10);
                setSelectedWaypointId(null);
                setSelectedSegmentId(null);

                if (window.innerWidth <= 768 && wp.coordinates) {
                   setTimeout(() => {
                     flyTo(wp.coordinates![0], wp.coordinates![1], 'open', false, 'trip');
                   }, 350);
                }
              }
            });
            
            markersRef.current.push({ marker, wp, pref });
          });
        });

        // Trigger an initial declutter
        if (mapRef.current) {
          mapRef.current.fire('move');
        }
      }
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrip, trips, mapLoaded, mapStyleLoadedTime, setSelectedSegmentId, setSelectedWaypointId, setHighlightedWaypointId, showHiddenSegments, selectedSegmentId, isReadOnly]);

  // Decluttering map markers on zoom/pan
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    
    const updateVisibility = () => {
      const map = mapRef.current;
      if (!map) return;
      
      const markers = markersRef.current;
      const sorted = [...markers].sort((a, b) => a.pref - b.pref);
      const visiblePositions: { x: number, y: number }[] = [];
      
      for (const m of sorted) {
        const pos = map.project(m.marker.getLngLat());
        
        let tooClose = false;
        for (const v of visiblePositions) {
          const dx = pos.x - v.x;
          const dy = pos.y - v.y;
          if (Math.sqrt(dx * dx + dy * dy) < MARKER_HIDE_THRESHOLD) {
            tooClose = true;
            break;
          }
        }
        
        if (tooClose) {
          m.marker.getElement().style.display = 'none';
        } else {
          // If we had 'flex' set before, use it
          m.marker.getElement().style.display = m.marker.getElement().classList.contains('pin-marker') ? 'block' : 'flex';
          visiblePositions.push(pos);
        }
      }
    };
    
    mapRef.current.on('move', updateVisibility);
    
    return () => {
      if (mapRef.current) {
        mapRef.current.off('move', updateVisibility);
      }
    };
  }, [mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    if (contextMenu) {
      if (!tempMarkerRef.current) {
        const el = document.createElement('div');
        el.style.width = '10px';
        el.style.height = '10px';
        el.style.backgroundColor = '#007bff';
        el.style.border = '2px solid white';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
        el.style.opacity = '0.8';
        
        tempMarkerRef.current = new Marker({ element: el })
          .setLngLat(contextMenu.lngLat)
          .addTo(mapRef.current);
      } else {
        tempMarkerRef.current.setLngLat(contextMenu.lngLat);
      }
    } else {
      if (tempMarkerRef.current) {
        tempMarkerRef.current.remove();
        tempMarkerRef.current = null;
      }
    }
  }, [contextMenu, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    
    if (selectedPOI && selectedPOI.coordinates) {
      if (!selectedPoiMarkerRef.current) {
        selectedPoiMarkerRef.current = new Marker({ color: '#e74c3c' })
          .setLngLat(selectedPOI.coordinates)
          .addTo(mapRef.current);
      } else {
        selectedPoiMarkerRef.current.setLngLat(selectedPOI.coordinates);
      }
    } else {
      if (selectedPoiMarkerRef.current) {
        selectedPoiMarkerRef.current.remove();
        selectedPoiMarkerRef.current = null;
      }
    }
  }, [selectedPOI, mapLoaded]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (layerSelectorRef.current && !layerSelectorRef.current.contains(event.target as Node)) {
        setShowLayerSelector(false);
      }
    };

    if (showLayerSelector) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showLayerSelector]);

  useEffect(() => {
    if (mapRef.current && mapLoaded) {
      const styleConfig = MAP_STYLES[activeMapStyle].url;
      mapRef.current.setStyle(styleConfig);
    }
  }, [activeMapStyle, mapLoaded]);

  return (
    <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div ref={mapContainer} id="map" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}></div>

      {activeMapStyle === 'mapy_outdoor' && (
        <div 
          className="mapy-logo-overlay" 
          style={{ cursor: 'pointer' }}
          onClick={() => {
            if (mapRef.current) {
              const center = mapRef.current.getCenter();
              const zoom = mapRef.current.getZoom();
              window.open(`https://mapy.com/en/turisticka?x=${center.lng}&y=${center.lat}&z=${Math.round(zoom)}`, '_blank');
            }
          }}
        >
          <img src="https://api.mapy.com/img/api/logo.svg" alt="Mapy.com" height="24" />   
        </div>
      )}

{/* Top Left Controls */}
        <div className="top-left-controls">
          <button
            className="map-control-button"
            onClick={() => setShowHiddenSegments(!showHiddenSegments)}
            title={showHiddenSegments ? "Hide invisible segments" : "Show invisible segments"}
            style={{ color: showHiddenSegments ? '#007bff' : 'inherit' }}
          >
            <span className="material-symbols-rounded">{showHiddenSegments ? "visibility" : "visibility_off"}</span>
          </button>

          <button
            className="map-control-button"
            onClick={onSearchClick}
            title="Search POI or Coordinates"
          >
            <span className="material-symbols-rounded">search</span>
          </button>
          
          <div ref={layerSelectorRef} style={{ position: 'relative' }}>
            <button
              className="map-control-button"
              onClick={() => setShowLayerSelector(!showLayerSelector)}
              title="Select map layer"
            >
              <span className="material-symbols-rounded">layers</span>
            </button>

            {showLayerSelector && (
              <div className="layer-selector-dropdown">
                {Object.entries(MAP_STYLES).map(([key, style]) => (
                  <div
                    key={key}
                    className="layer-option"
                    style={{
                      backgroundColor: activeMapStyle === key ? '#f0f0f0' : 'transparent',
                      fontWeight: activeMapStyle === key ? 'bold' : 'normal'
                    }}
                    onClick={() => {
                      setActiveMapStyle(key);
                      setShowLayerSelector(false);
                    }}
                  >
                    {style.name}
                  </div>
                ))}
              </div>
            )}
          </div>
      </div>
      
      {hoverInfo && !isDraggingGhostRef.current && (
        <div 
          className="hover-tooltip"
          style={{ 
            position: 'fixed', top: hoverInfo.y + 15, left: hoverInfo.x + 15, 
            background: 'rgba(0,0,0,0.8)', padding: '6px 10px', 
            zIndex: 1000, borderRadius: '4px', fontSize: '13px', color: 'white',
            pointerEvents: 'none', whiteSpace: 'nowrap'
          }}
        >
          {hoverInfo.name && (
            <>
              <strong>{hoverInfo.name}</strong><br />
            </>
          )}
          <span style={{opacity: 0.8}}>{hoverInfo.mode}</span>
        </div>
      )}
      
      {contextMenu && selectedTrip && (
        <div 
          className="context-menu"
          style={{ 
            position: 'fixed', top: contextMenu.y, left: contextMenu.x, 
            background: 'white', border: '1px solid #ccc', padding: '8px 12px', 
            zIndex: 1000, boxShadow: '0 2px 5px rgba(0,0,0,0.2)', cursor: 'pointer',
            borderRadius: '4px', fontSize: '14px', color: '#333'
          }}
          onClick={() => {
            const lastSegment = selectedTrip.segments[selectedTrip.segments.length - 1];
            if (lastSegment) {
              const newWaypoint = {
                id: 'wp-' + Date.now(),
                name: '',
                coordinates: contextMenu.lngLat,
                importance: 'hidden' as 'hidden'
              };
              const newSegments = [...selectedTrip.segments];
              const wpRef = newSegments[newSegments.length - 1];
              newSegments[newSegments.length - 1] = {
                ...wpRef,
                waypoints: [...wpRef.waypoints, newWaypoint as any]
              };
              
              hotkeyRefs.current.updateTripState(selectedTrip.id, { ...selectedTrip, segments: newSegments });
              
              const validCoords = newSegments[newSegments.length - 1].waypoints.filter(w => w.coordinates && (w.coordinates as any).length === 2).map((w: any) => w.coordinates as [number, number]);
              if (validCoords.length >= 2 && lastSegment.source === 'router') {
                  optimizeSegmentRoute(newSegments[newSegments.length - 1], lastSegment).then((geom: any) => {
                      newSegments[newSegments.length - 1] = { ...newSegments[newSegments.length - 1], geometry: geom };
                      hotkeyRefs.current.updateTripState(selectedTrip.id, { ...selectedTrip, segments: [...newSegments] });
                  });
              }
            }
            setContextMenu(null);
          }}
        >
          Add to trip
        </div>
      )}
    </div>
  );
});

// touch
