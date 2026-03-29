import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import type { Segment, Trip } from '../../../shared/types';
import { Map as MapLibreMap, NavigationControl, GeoJSONSource, Marker, LngLatBounds } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/Map.css';
// Removed unused route import
import { optimizeSegmentRoute } from '../routing/routeOptimizer';
import { ModeThemes } from '../themes/config';
import * as turf from '@turf/turf';
import { MAP_STYLES, POI_LAYERS } from '../config/mapStyles';
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
    zoomToTrip: (trip: Trip) => void;
    zoomToSegment: (segment: Segment) => void;
    handleJumpToWaypoint: (waypointId: string) => void;
    flyTo: (lon: number, lat: number) => void;
}

export interface MapProps {
    trips: Trip[];
    selectedTrip: Trip | null;
    waitingWaypointId: string | null;
    waitingWaypointIdRef: React.MutableRefObject<string | null>;
    setWaitingWaypointId: (id: string | null) => void;
    updateTripState: (tripId: string, newTrip: Trip, replaceLastHistory?: boolean) => void;
    handleCoordinateChange: (trip: Trip, wpId: string, coords: [number, number]) => Promise<void>;
    setSelectedWaypointId: (id: string | null) => void;
    setHighlightedWaypointId: (id: string | null) => void;
    setSelectedSegmentId: (id: string | null) => void;
    selectedPOI: any | null;
    setSelectedPOI: (poi: any | null) => void;
    hoveredCoordinate: { lon: number; lat: number; ele?: number } | null;
    onHoverCoordinate: (coord: { lon: number; lat: number; ele?: number } | null) => void;
    onSearchClick: () => void;
}

export const Map = forwardRef<MapRef, MapProps>(({
    trips,
    selectedTrip,
    waitingWaypointId,
    waitingWaypointIdRef,
    setWaitingWaypointId,
    updateTripState,
    handleCoordinateChange,
    setSelectedWaypointId,
    setHighlightedWaypointId,
    setSelectedSegmentId,
    selectedPOI,
    setSelectedPOI,
    hoveredCoordinate,
    onHoverCoordinate,
    onSearchClick
}, ref) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const tempMarkerRef = useRef<Marker | null>(null);
  const hoverCoordMarkerRef = useRef<Marker | null>(null);
  const selectedPoiMarkerRef = useRef<Marker | null>(null);
  const ghostMarkerRef = useRef<Marker | null>(null);
  const ghostMarkerDataRef = useRef<{ segmentId: string, originalWaypoints: any[], insertIndex: number } | null>(null);
  const isDraggingGhostRef = useRef(false);
  const isHoveringWaypointRef = useRef(false);
  const layerSelectorRef = useRef<HTMLDivElement>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [activeMapStyle, setActiveMapStyle] = useState<string>('openfreemap');
  const [showLayerSelector, setShowLayerSelector] = useState(false);
  const [mapStyleLoadedTime, setMapStyleLoadedTime] = useState(Date.now());
  const [hoverInfo, setHoverInfo] = useState<{ x: number, y: number, name: string, mode: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, lngLat: [number, number] } | null>(null);

  const hotkeyRefs = useRef({ selectedTrip, updateTripState, handleCoordinateChange, setSelectedPOI });

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
    hotkeyRefs.current = { selectedTrip, updateTripState, handleCoordinateChange, setSelectedPOI };
  }, [selectedTrip, updateTripState, handleCoordinateChange, setSelectedPOI]);

  const zoomToTrip = (trip: Trip) => {
    if (!mapRef.current) return;
    
    // Find waypoint and neighbors
    const allWps: { id: string, coordinates: [number, number] }[] = [];
    trip.segments.forEach(seg => {
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

    requestAnimationFrame(() => {
      if (!mapRef.current) return;
      const camera = mapRef.current.cameraForBounds(bounds, { padding: 50 });
      if (camera) {
        mapRef.current.flyTo({
          ...camera,
          essential: true,
          duration: 1200
        });
      }
    });
  };

  const zoomToSegment = (seg: Segment) => {
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
      const camera = mapRef.current.cameraForBounds(bounds, { padding: 50 });
      if (camera) {
        mapRef.current.flyTo({
          ...camera,
          essential: true,
          duration: 1200
        });
      }
    });
  };

  const handleJumpToWaypoint = (waypointId: string) => {
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
      const camera = mapRef.current.cameraForBounds(bounds, { padding: 50 });
      if (camera) {
        mapRef.current.flyTo({
          center: targetCoord,
          zoom: Math.min(camera.zoom || 15, 15),
          duration: 1200,
          essential: true
        });
      }
    });
  };

  const flyTo = (lon: number, lat: number) => {
    mapRef.current?.flyTo({
      center: [lon, lat],
      zoom: 14,
      essential: true
    });
  };

  useImperativeHandle(ref, () => ({
    zoomToTrip,
    zoomToSegment,
    handleJumpToWaypoint,
    flyTo
  }));

  useEffect(() => {
    if (!mapContainer.current) return;
    if (mapRef.current) return;
    
    mapRef.current = new MapLibreMap({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/liberty', // Free basemap
      center: [11.3933, 47.2692],
      zoom: 9
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
      
        mapRef.current.on('contextmenu', (e) => {
          e.preventDefault();
          if (!hotkeyRefs.current.selectedTrip) return;
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
            if (mapRef.current?.getLayer('route-layer') && hotkeyRefs.current.selectedTrip) {
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

          if (features.length > 0 && hotkeyRefs.current.selectedTrip) {
            const feature = features[0];
            const segId = feature.properties.segmentId;
            const segInfo = hotkeyRefs.current.selectedTrip.segments.find((s: any) => s.id === segId);
            
            mapRef.current!.getCanvas().style.cursor = 'pointer';
            setHoverInfo({
              x: e.originalEvent.clientX,
              y: e.originalEvent.clientY,
              name: segInfo?.name || '',
              mode: feature.properties.mode
            });
            
            if (segInfo && segInfo.geometry && segInfo.geometry.coordinates.length > 1) {
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
                
                ghostMarkerRef.current = new Marker({ element: el, draggable: true })
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
                poiData = { ...poi.properties, coordinates: poiCoord, id: poi.id || `poi` };
              }
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

            const currentTrip = hotkeyRefs.current.selectedTrip;
            const newSegments = [...currentTrip.segments];
            let changed = false;

            for (let i = 0; i < newSegments.length; i++) {
              const seg = { ...newSegments[i] };
              const wpIdx = seg.waypoints.findIndex(w => w.id === wpId);
              if (wpIdx > -1) {
                seg.waypoints = seg.waypoints.map(w => w.id === wpId ? { ...w, coordinates: coords } : w);
                
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
                paint: { 'line-color': ['get', 'color'], 'line-width': 4 }
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
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];

      if (!selectedTrip) {
        const allFeatures: GeoJSON.Feature[] = [];
        trips.forEach(trip => {
           trip.segments.forEach(seg => {
             allFeatures.push({
               type: 'Feature',
               properties: { segmentId: seg.id, mode: seg.transportMode, color: ModeThemes[seg.transportMode]?.color || '#007bff' },
               geometry: getRenderGeometry(seg) as any
             });
           });
        });
        source.setData({
          type: 'FeatureCollection',
          features: allFeatures
        });
      } else {
        const features: GeoJSON.Feature[] = selectedTrip.segments.map(seg => ({
          type: 'Feature',
          properties: { segmentId: seg.id, mode: seg.transportMode, color: ModeThemes[seg.transportMode]?.color || '#007bff' },
          geometry: getRenderGeometry(seg) as any
        }));
        source.setData({
          type: 'FeatureCollection',
          features
        });

        // Add markers
        selectedTrip.segments.forEach((seg, segIndex) => {
          const currSegColor = ModeThemes[seg.transportMode]?.color || '#007bff';
          seg.waypoints.forEach((wp, wpIndex) => {          if (!wp.coordinates || wp.coordinates.length < 2) return;
                      const isLastInSeg = wpIndex === seg.waypoints.length - 1;
            const isLastSegment = segIndex === selectedTrip.segments.length - 1;

            if (isLastInSeg && !isLastSegment) {
              return; // Border waypoints take the color of the segment starting at that waypoint (the next one)
            }

            const isBordering = wpIndex === 0 && segIndex > 0;

            const el = document.createElement('div');
            el.style.width = wp.importance === 'hidden' ? '10px' : '14px';
            el.style.height = wp.importance === 'hidden' ? '10px' : '14px';
            el.style.borderRadius = '50%';
            
            const prevSegColor = isBordering ? (ModeThemes[selectedTrip.segments[segIndex - 1].transportMode]?.color || '#007bff') : currSegColor;
            const backgroundStyle = isBordering 
              ? `linear-gradient(to bottom, ${prevSegColor} 50%, ${currSegColor} 50%)`
              : currSegColor;
              
            el.style.background = backgroundStyle;
            el.style.border = wp.importance === 'hidden' ? 'none' : '2px solid white';
            el.style.boxShadow = wp.importance === 'hidden' ? 'none' : '0 1px 3px rgba(0,0,0,0.3)';
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.justifyContent = 'center';
            el.style.cursor = 'pointer';

            if (wp.importance === 'hidden') {
               const inner = document.createElement('div');
               inner.style.width = wp.importance === 'hidden' ? '6px' : '8px';
               inner.style.height = wp.importance === 'hidden' ? '6px' : '8px';
               inner.style.background = 'white';
               inner.style.borderRadius = '50%';
               el.appendChild(inner);
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


            const marker = new Marker({ element: el, draggable: true })
              .setLngLat(wp.coordinates as [number, number])
              .addTo(mapRef.current!);

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

            marker.getElement().addEventListener('click', (e) => {
              e.stopPropagation();
              if (e.ctrlKey || e.metaKey) {
                setSelectedWaypointId(wp.id);
                setHighlightedWaypointId(null);
              } else {
                setHighlightedWaypointId(null);
                setTimeout(() => setHighlightedWaypointId(wp.id), 10);
                setSelectedWaypointId(null);
                setSelectedSegmentId(null);
              }
            });
            
            markersRef.current.push(marker);
          });
        });
      }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTrip, trips, mapLoaded, mapStyleLoadedTime, setSelectedSegmentId, setSelectedWaypointId, setHighlightedWaypointId]);

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
