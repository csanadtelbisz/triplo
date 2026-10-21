import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';

export interface TripScatterPoint { id: string; name: string; distance: number; impact: number }

const ceiling = (value: number) => {
  const step = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  return Math.ceil(Math.max(1, value) * 1.1 / step) * step;
};

export function TripScatterPlot({ points }: { points: TripScatterPoint[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = points.find(point => point.id === activeId);
  const width = 340, height = 210, left = 48, bottom = 176, right = 305, top = 24;
  const maxDistance = ceiling(Math.max(0, ...points.map(point => point.distance)));
  const maxImpact = ceiling(Math.max(0, ...points.map(point => point.impact)));
  const position = (point: TripScatterPoint) => ({ x: left + point.distance / maxDistance * (right - left), y: bottom - point.impact / maxImpact * (bottom - top) });
  const hover = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !svg.current) return;
    const cursor = svg.current.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    // Measure in screen pixels so the target radius stays usable at every sidebar width.
    let closest: TripScatterPoint | undefined, distance = 24;
    for (const point of points) {
      const p = position(point);
      const screenPoint = svg.current.createSVGPoint();
      screenPoint.x = p.x;
      screenPoint.y = p.y;
      const screen = screenPoint.matrixTransform(matrix);
      const d = Math.hypot(screen.x - cursor.x, screen.y - cursor.y);
      if (d < distance) { distance = d; closest = point; }
    }
    setActiveId(closest?.id || null);
  };
  return <section className="trip-scatter" aria-label="Trip comparison">
    <h3>Distance and climate impact by trip</h3>
    <div className="trip-scatter-readout" aria-live="polite" aria-atomic="true">
      <strong>{active?.name || 'Explore trips'}</strong>
      <span>{active ? `${active.distance.toFixed(1)} km · ${active.impact.toFixed(1)} kg CO₂e` : 'Hover or slide over a point'}</span>
    </div>
    {points.length === 0 ? <p>No trips with complete estimates match these filters.</p> : <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Trips by distance and climate impact"
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); hover(event); }}
      onPointerMove={hover} onPointerLeave={event => { if (event.pointerType === 'mouse' && !event.currentTarget.hasPointerCapture(event.pointerId)) setActiveId(null); }}
      onPointerCancel={() => setActiveId(null)}
      onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}>
      {[0, .5, 1].map(fraction => <g key={fraction} className="trip-scatter-grid">
        <line x1={left} x2={right} y1={bottom - fraction * (bottom - top)} y2={bottom - fraction * (bottom - top)} />
        <text x={left - 7} y={bottom - fraction * (bottom - top) + 4} textAnchor="end">{(maxImpact * fraction).toLocaleString(undefined, { maximumFractionDigits: 1 })}</text>
        <text x={left + fraction * (right - left)} y={bottom + 18} textAnchor="middle">{(maxDistance * fraction).toLocaleString(undefined, { maximumFractionDigits: 1 })}</text>
      </g>)}
      <path className="trip-scatter-axes" d={`M ${left} ${top - 12} V ${bottom} H ${right + 14}`} />
      <g role="img" aria-label="Climate impact in kilograms CO₂e"><title>Climate impact (kg CO₂e)</title><text className="trip-scatter-axis-label" x={left} y={12} textAnchor="middle">kg CO₂e</text></g>
      <g role="img" aria-label="Distance in kilometres"><title>Distance (km)</title><text className="trip-scatter-axis-label" x={right + 14} y={bottom - 6}>km</text></g>
      {points.map(point => {
        const p = position(point), selected = activeId === point.id;
        return <circle key={point.id} cx={p.x} cy={p.y} r={selected ? 7 : 4.5} className={`trip-scatter-point${selected ? ' active' : ''}`}
          data-trip-id={point.id} role="img" tabIndex={0} aria-label={`${point.name}: ${point.distance.toFixed(1)} km, ${point.impact.toFixed(1)} kg CO₂e`}
          onFocus={() => setActiveId(point.id)} onBlur={() => setActiveId(null)} />;
      })}
    </svg>}
  </section>;
}
