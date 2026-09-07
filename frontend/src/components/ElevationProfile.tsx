import { useEffect, useMemo, useRef, useState } from 'react';

interface ElevationProfileProps {
  geometry: GeoJSON.LineString;
  hoveredCoordinate?: { lon: number; lat: number; ele?: number } | null;
  onHoverCoordinate?: (coord: { lon: number; lat: number; ele?: number } | null) => void;
}

export function ElevationProfile({ geometry, hoveredCoordinate, onHoverCoordinate }: ElevationProfileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number, ele: number, dist: number } | null>(null);
  const hoveredIndexRef = useRef<number | null>(null);
  const pendingIndexRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const width = 400;
  const height = 150;

  // The geometry does not change while the user explores the profile. Build this
  // potentially large data set and its SVG paths only when the route changes.
  const profile = useMemo(() => {
    if (!geometry?.coordinates || geometry.coordinates.length < 2 || !geometry.coordinates.some(coord => coord[2] !== undefined && coord[2] !== 0)) {
      return null;
    }

    const data: { dist: number; ele: number }[] = [];
    let currentDist = 0;
    let minEle = Infinity;
    let maxEle = -Infinity;

    for (let i = 0; i < geometry.coordinates.length; i++) {
      const coord = geometry.coordinates[i];
      if (i > 0) {
        const previous = geometry.coordinates[i - 1];
        const lat1 = previous[1] * Math.PI / 180;
        const lat2 = coord[1] * Math.PI / 180;
        const deltaLat = lat2 - lat1;
        const deltaLon = (coord[0] - previous[0]) * Math.PI / 180;
        const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
        currentDist += 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }

      const ele = coord[2] ?? (data[data.length - 1]?.ele ?? 0);
      minEle = Math.min(minEle, ele);
      maxEle = Math.max(maxEle, ele);
      data.push({ dist: currentDist, ele });
    }

    if (currentDist === 0) return null;

    const elevationRange = Math.max(maxEle - minEle, 10);
    const paddingY = elevationRange * 0.1;
    const chartMinEle = minEle - paddingY;
    const chartEleRange = elevationRange + paddingY * 2;
    const points = data.map(({ dist, ele }) => {
      const x = (dist / currentDist) * width;
      const y = height - ((ele - chartMinEle) / chartEleRange) * height;
      return `${x},${y}`;
    });

    return {
      data,
      maxDist: currentDist,
      minEle,
      maxEle,
      pathD: `M 0,${height} L ${points.join(' ')} L ${width},${height} Z`,
      lineD: `M ${points.join(' ')}`
    };
  }, [geometry]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const data = profile?.data ?? [];
  const maxDist = profile?.maxDist ?? 0;
  const minEle = profile?.minEle ?? 0;
  const maxEle = profile?.maxEle ?? 0;
  const pathD = profile?.pathD ?? '';
  const lineD = profile?.lineD ?? '';

  const updateHoverFromClientX = (clientX: number) => {
    if (!containerRef.current || !data.length || maxDist === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const w = rect.width;
    
    const targetDist = (x / w) * maxDist;
    let low = 0;
    let high = data.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (data[middle].dist < targetDist) low = middle + 1;
      else high = middle;
    }
    const closestIdx = low > 0 && Math.abs(data[low - 1].dist - targetDist) < Math.abs(data[low].dist - targetDist)
      ? low - 1
      : low;

    pendingIndexRef.current = closestIdx;
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const index = pendingIndexRef.current;
      if (index === null || index === hoveredIndexRef.current) return;
      hoveredIndexRef.current = index;

      const closest = data[index];
      setTooltip({ x: (closest.dist / maxDist) * 100, ele: closest.ele, dist: closest.dist });
      const coord = geometry.coordinates[index];
      onHoverCoordinate?.({ lon: coord[0], lat: coord[1], ele: closest.ele });
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Capture the touch so moving over chart labels or slightly outside its bounds
    // continues to update the selected coordinate.
    e.currentTarget.setPointerCapture(e.pointerId);
    updateHoverFromClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    updateHoverFromClientX(e.clientX);
  };

  const handleMouseLeave = () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    pendingIndexRef.current = null;
    hoveredIndexRef.current = null;
    setTooltip(null);
    onHoverCoordinate?.(null);
  };

  // If hoveredCoordinate comes from map, find matching x position
  const syncData = useMemo(() => {
    // During a profile drag, tooltip already describes the selected point. Skipping
    // this reverse lookup avoids another full route scan for every marker update.
    if (!profile || tooltip || !hoveredCoordinate || !maxDist) return null;

      let minDist = Infinity;
      let closestIdx = -1;
      for (let i = 0; i < geometry.coordinates.length; i++) {
          const coord = geometry.coordinates[i];
          const dist = Math.pow(coord[0] - hoveredCoordinate.lon, 2) + Math.pow(coord[1] - hoveredCoordinate.lat, 2);
          if (dist < minDist) {
              minDist = dist;
              closestIdx = i;
          }
      }
      if (closestIdx !== -1) {
        return { x: (data[closestIdx].dist / maxDist) * 100, ele: data[closestIdx].ele, dist: data[closestIdx].dist };
      }
      return null;
  }, [data, geometry.coordinates, hoveredCoordinate, maxDist, profile, tooltip]);

  if (!profile) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: '0.9rem', marginBottom: 8, color: '#333' }}>Elevation Profile</h4>
      <div 
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handleMouseLeave}
        onPointerUp={handleMouseLeave}
        onPointerCancel={handleMouseLeave}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onTouchCancel={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', height: '150px', background: '#f9f9f9', borderRadius: 4, overflow: 'hidden', cursor: 'pointer', touchAction: 'none' }}
      >
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <path d={pathD} fill="rgba(0, 123, 255, 0.2)" />
          <path d={lineD} fill="none" stroke="#007bff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ position: 'absolute', bottom: 4, right: 4, fontSize: '10px', color: '#666', pointerEvents: 'none' }}>
          {maxDist.toFixed(1)} km
        </div>
        <div style={{ position: 'absolute', top: 4, left: 4, fontSize: '10px', color: '#666', pointerEvents: 'none' }}>
          {Math.round(maxEle)} m
        </div>
        <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: '10px', color: '#666', pointerEvents: 'none' }}>
          {Math.round(minEle)} m
        </div>
        
        {tooltip && (
            <div style={{
                position: 'absolute',
                left: `${tooltip.x}%`,
                top: 0,
                bottom: 0,
                width: '1px',
                backgroundColor: 'red',
                pointerEvents: 'none'
            }}>
                <div style={{
                    position: 'absolute',
                    top: '10px',
                    ...(tooltip.x > 80 ? { right: '5px' } : { left: '5px' }),
                    backgroundColor: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    padding: '2px 4px',
                    borderRadius: '2px',
                    fontSize: '10px',
                    whiteSpace: 'nowrap'
                }}>
                    {Math.round(tooltip.ele)}m ({tooltip.dist.toFixed(1)}km)
                </div>
            </div>
        )}
        
        {syncData && !tooltip && (
            <div style={{
                position: 'absolute',
                left: `${syncData.x}%`,
                top: 0,
                bottom: 0,
                width: '1px',
                backgroundColor: 'red',
                pointerEvents: 'none'
            }}>
                <div style={{
                        position: 'absolute',
                        top: '10px',
                        ...(syncData.x > 80 ? { right: '5px' } : { left: '5px' }),
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        color: 'white',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        fontSize: '10px',
                        whiteSpace: 'nowrap'
                    }}>
                        {Math.round(syncData.ele)}m ({syncData.dist.toFixed(1)}km)
                    </div>
            </div>
        )}
      </div>
    </div>
  );
}
