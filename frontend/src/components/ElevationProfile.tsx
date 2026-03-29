import * as turf from '@turf/turf';
import { useState, useRef } from 'react';

interface ElevationProfileProps {
  geometry: GeoJSON.LineString;
  hoveredCoordinate?: { lon: number; lat: number; ele?: number } | null;
  onHoverCoordinate?: (coord: { lon: number; lat: number; ele?: number } | null) => void;
}

export function ElevationProfile({ geometry, hoveredCoordinate, onHoverCoordinate }: ElevationProfileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number, ele: number, dist: number } | null>(null);

  if (!geometry || !geometry.coordinates || geometry.coordinates.length < 2) {
    return null;
  }

  // Check if we have elevation data (third coordinate)
  const hasElevation = geometry.coordinates.some(c => c.length > 2 && c[2] !== undefined);
  if (!hasElevation) {
    return null;
  }

  // Calculate distance and elevation at each point
  const data: { dist: number; ele: number }[] = [];
  let currentDist = 0;

  for (let i = 0; i < geometry.coordinates.length; i++) {
    const coord = geometry.coordinates[i];
    if (i > 0) {
      const prev = geometry.coordinates[i - 1];
      const pt1 = turf.point([prev[0], prev[1]]);
      const pt2 = turf.point([coord[0], coord[1]]);
      currentDist += turf.distance(pt1, pt2, { units: 'kilometers' });
    }
    
    // Fallback elevation to previous point or 0 if missing
    let ele = coord.length > 2 && coord[2] !== undefined ? coord[2] : (data.length > 0 ? data[data.length - 1].ele : 0);
    data.push({ dist: currentDist, ele });
  }

  if (data.length < 2) return null;

  const maxDist = data[data.length - 1].dist;
  if (maxDist === 0) return null;

  const minEle = Math.min(...data.map(d => d.ele));
  const maxEle = Math.max(...data.map(d => d.ele));
  const eleRange = Math.max(maxEle - minEle, 10); // Prevent zero division
  
  // Padding for chart
  const paddingY = eleRange * 0.1;
  const chartMinEle = minEle - paddingY;
  const chartMaxEle = maxEle + paddingY;
  const chartEleRange = chartMaxEle - chartMinEle;

  const width = 400;
  const height = 150;

  // Generate SVG path
  const points = data.map(d => {
    const x = (d.dist / maxDist) * width;
    const y = height - ((d.ele - chartMinEle) / chartEleRange) * height;
    return `${x},${y}`;
  });

  const pathD = `M 0,${height} L ${points.join(' ')} L ${width},${height} Z`;
  const lineD = `M ${points.join(' ')}`;

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || !data.length || maxDist === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    
    // Find closest data point
    const targetDist = (x / w) * maxDist;
    // Basic binary search or linear search
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < data.length; i++) {
        const diff = Math.abs(data[i].dist - targetDist);
        if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
        }
    }
    
    const closest = data[closestIdx];
    const hoverX = (closest.dist / maxDist) * 100;
    setTooltip({ x: hoverX, ele: closest.ele, dist: closest.dist });
    
    if (onHoverCoordinate) {
        const coord = geometry.coordinates[closestIdx];
        onHoverCoordinate({ lon: coord[0], lat: coord[1], ele: closest.ele });
    }
  };

  const handleMouseLeave = () => {
    setTooltip(null);
    if (onHoverCoordinate) {
        onHoverCoordinate(null);
    }
  };

  // If hoveredCoordinate comes from map, find matching x position
  let syncX: number | null = null;
  let syncData: { ele: number, dist: number } | null = null;
  if (hoveredCoordinate && hoveredCoordinate.lon && containerRef.current && maxDist > 0) {
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
          syncX = (data[closestIdx].dist / maxDist) * 100; // as percentage
          syncData = { ele: data[closestIdx].ele, dist: data[closestIdx].dist };
      }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: '0.9rem', marginBottom: 8, color: '#333' }}>Elevation Profile</h4>
      <div 
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ position: 'relative', width: '100%', height: '150px', background: '#f9f9f9', borderRadius: 4, overflow: 'hidden', cursor: 'pointer' }}
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
        
        {syncX !== null && !tooltip && (
            <div style={{
                position: 'absolute',
                left: `${syncX}%`,
                top: 0,
                bottom: 0,
                width: '1px',
                backgroundColor: 'red',
                pointerEvents: 'none'
            }}>
                {syncData && (
                    <div style={{
                        position: 'absolute',
                        top: '10px',
                        ...(syncX > 80 ? { right: '5px' } : { left: '5px' }),
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        color: 'white',
                        padding: '2px 4px',
                        borderRadius: '2px',
                        fontSize: '10px',
                        whiteSpace: 'nowrap'
                    }}>
                        {Math.round(syncData.ele)}m ({syncData.dist.toFixed(1)}km)
                    </div>
                )}
            </div>
        )}
      </div>
    </div>
  );
}
