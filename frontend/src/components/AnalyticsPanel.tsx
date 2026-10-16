import { useEffect, useMemo, useState, useRef } from 'react';
import type { Segment, Trip, TransportMode } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { getCustomOtherModes, getModeAndIconColor } from '../utils/customModesPreferences';
import type { CustomOtherMode } from '../utils/customModesPreferences';
import type { AnalyticsSelection } from '../countries/analytics';
import { countryYearDistances, selectedDistance, tripFraction, tripIntersects } from '../countries/analytics';
import type { CountryData } from '../countries/types';
import { UNASSIGNED, segmentKey } from '../countries/types';
import '../styles/Analytics.css';
import {
  buildTransportModeFilterStyleConfig,
  clearTransientStyleConfig,
  getActiveStyleConfigId,
  getStyleConfigs,
  getResolvedActiveStyleConfig,
  setTransientStyleConfig
} from '../utils/mapStylesPreferences';

interface AnalyticsPanelProps {
  onGoBack: () => void;
  trips: Trip[];
  isReadOnly: boolean;
  onUpdateTrip: (trip: Trip) => void;
  onOpenSegmentInfo: (tripId: string, segmentId: string) => void;
  onFocusSegment: (tripId: string, segmentId: string) => void;
  timeSliderVisible: boolean;
  onToggleTimeSlider: () => void;
  selection: AnalyticsSelection;
  onSelectionChange: (selection: AnalyticsSelection, replace?: boolean) => void;
  countryData?: CountryData;
  countryLoading: boolean;
  countryError?: string;
  onRetryCountries: () => void;
}

type SegmentEntry = {
  trip: Trip;
  segment: Segment;
};

function getModeKeyForSegment(segment: Segment) {
  return segment.transportMode === 'other' && segment.customIcon ? `other:${segment.customIcon}` : segment.transportMode;
}

function getModeLabel(modeKey: string, customModes: CustomOtherMode[]) {
  if (modeKey.startsWith('other:')) {
    const icon = modeKey.split(':')[1];
    return customModes.find(mode => mode.icon === icon)?.name || icon.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  }

  return modeKey.replace('_', ' ');
}

function getTripDateRange(trips: Trip[]) {
  const dates = trips.flatMap(trip => [trip.startDate, trip.endDate || trip.startDate].filter(Boolean).map(date => new Date(date as string).getTime()));
  if (dates.length === 0) return null;
  const day = 24 * 60 * 60 * 1000;
  return {
    min: Math.floor(Math.min(...dates) / day) * day,
    max: Math.floor(Math.max(...dates) / day) * day
  };
}

function formatFilterDate(timestamp: number, yearOnly: boolean) {
  return new Intl.DateTimeFormat(undefined, yearOnly ? { year: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(timestamp));
}

export function TimeSliderToolbox({ trips, onClose, range, onRangeChange }: { trips: Trip[]; onClose: () => void; range: [number, number] | null; onRangeChange: (range: [number, number]) => void }) {
  const dateRange = useMemo(() => getTripDateRange(trips), [trips]);
  const day = 24 * 60 * 60 * 1000;
  const [yearOnly, setYearOnly] = useState(false);

  const effectiveRange = dateRange
    ? range
      ? [Math.max(dateRange.min, range[0]), Math.min(dateRange.max, range[1])] as [number, number]
      : [dateRange.min, dateRange.max] as [number, number]
    : null;

  if (!dateRange || !effectiveRange) {
    return <div className="time-slider-empty">No trip dates available</div>;
  }

  const minYear = new Date(dateRange.min).getFullYear();
  const maxYear = new Date(dateRange.max).getFullYear();
  const yearCount = Math.max(0, maxYear - minYear);

  const maxValue = yearOnly ? yearCount : Math.ceil((dateRange.max - dateRange.min) / day);

  const toTimestamp = (value: number, endOfYear = false) => {
    if (yearOnly) {
      const year = minYear + value;
      return new Date(year, endOfYear ? 11 : 0, endOfYear ? 31 : 1).getTime();
    }
    return dateRange.min + value * day;
  };

  const toSliderValue = (timestamp: number) => {
    if (yearOnly) {
      return new Date(timestamp).getFullYear() - minYear;
    }
    return Math.round((timestamp - dateRange.min) / day);
  };

  const updateRange = (nextRange: [number, number]) => {
    onRangeChange(nextRange);
  };
  const updateStart = (value: number) => updateRange([Math.min(toTimestamp(value), effectiveRange[1]), effectiveRange[1]]);
  const updateEnd = (value: number) => updateRange([effectiveRange[0], Math.max(toTimestamp(value, true), effectiveRange[0])]);

  const values = [toSliderValue(effectiveRange[0]), toSliderValue(effectiveRange[1])];

  return (
    <div className="time-slider-content">
      <div className="time-slider-labels">
        <span>{formatFilterDate(effectiveRange[0], yearOnly)}</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className={`iconButton time-slider-granularity ${yearOnly ? 'active' : ''}`}
            title={yearOnly ? 'Yearly granularity' : 'Daily granularity'}
            onClick={() => setYearOnly(value => !value)}
          >
            <MaterialIcon name={yearOnly ? 'calendar_lock' : 'calendar_month'} size={18} />
          </button>
          <button
            type="button"
            className="iconButton time-slider-close"
            title="Close slider"
            onClick={onClose}
          >
            <MaterialIcon name="close" size={18} />
          </button>
        </div>
        <span>{formatFilterDate(effectiveRange[1], yearOnly)}</span>
      </div>
      <div className="time-slider-track">
        <input aria-label="Analytics start date" type="range" min={0} max={maxValue} step={1} value={values[0]} onChange={event => updateStart(Number(event.target.value))} />
        <input aria-label="Analytics end date" type="range" min={0} max={maxValue} step={1} value={values[1]} onChange={event => updateEnd(Number(event.target.value))} />
      </div>
    </div>
  );
}

interface YearDistance {
  year: number;
  distance: number;
}

function calculateDaysOverlapInYear(startDate: Date, endDate: Date, year: number): number {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  const overlapStart = new Date(Math.max(startDate.getTime(), yearStart.getTime()));
  const overlapEnd = new Date(Math.min(endDate.getTime(), yearEnd.getTime()));

  if (overlapStart > overlapEnd) return 0;

  return Math.floor((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

function getDistancePerYear(trips: Trip[], selectedModeKey: string | null): YearDistance[] {
  const distanceByYear: Record<number, number> = {};
  const yearSet = new Set<number>();

  trips.forEach(trip => {
    const startDate = trip.startDate ? new Date(trip.startDate) : null;
    const endDate = trip.endDate ? new Date(trip.endDate) : startDate;

    if (!startDate || !endDate) return;

    // Determine which years this trip spans
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    const totalDays = Math.max(1, Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    for (let year = startYear; year <= endYear; year++) {
      yearSet.add(year);
      const daysInYear = calculateDaysOverlapInYear(startDate, endDate, year);

      // Get distance for this trip, filtered by mode
      let distanceForMode = 0;

      if (selectedModeKey) {
        // Only count distance for the selected mode
        const modeKey = selectedModeKey;
        const summary = trip.tripDistanceSummary;
        if (summary?.distanceByMode) {
          distanceForMode = (summary.distanceByMode[modeKey] as number) || 0;
        }
      } else {
        // Count all modes
        const summary = trip.tripDistanceSummary;
        if (summary?.totalDistance) {
          distanceForMode = summary.totalDistance;
        }
      }

      // Distribute proportionally by days
      const distributedDistance = (distanceForMode * daysInYear) / totalDays;
      distanceByYear[year] = (distanceByYear[year] || 0) + distributedDistance;
    }
  });

  return Array.from(yearSet)
    .sort((a, b) => a - b)
    .map(year => ({ year, distance: distanceByYear[year] || 0 }));
}

function YearlyDistanceChart({ yearDistances, maxDistance, modeColor, selectedYear, onSelectedYearChange, interactive }: { yearDistances: YearDistance[]; maxDistance: number; modeColor?: string; selectedYear: number | null; onSelectedYearChange: (year: number | null) => void; interactive: boolean }) {
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);
  const [tooltipXPosition, setTooltipXPosition] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const chartHeight = 150;
  const tooltipHeight = 20; // Space for tooltip above the chart
  const padding = 20;
  const innerHeight = chartHeight - padding * 2;
  const barColor = modeColor || '#82b1ff';
  
  // For responsive sizing, we'll calculate bar width based on the number of years
  const minBarWidth = 20;
  const maxBarWidth = 60;
  const calculatedBarWidth = Math.min(maxBarWidth, Math.max(minBarWidth, 280 / yearDistances.length));

  // Determine which year labels to show based on available space
  const estimatedLabelWidth = 32;
  const spacingPerBar = calculatedBarWidth;
  const labelInterval = Math.max(1, Math.ceil(estimatedLabelWidth / spacingPerBar));

  const activeYear = hoveredYear ?? selectedYear;
  const hoveredIndex = activeYear !== null ? yearDistances.findIndex(d => d.year === activeYear) : -1;
  const hoveredData = hoveredYear !== null ? yearDistances.find(d => d.year === hoveredYear) : null;
  const viewBoxWidth = Math.max(300, yearDistances.length * calculatedBarWidth + padding * 2);

  const updateHoveredYearFromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;

    // Convert the pointer from viewport pixels to viewBox coordinates. This keeps
    // hit testing accurate if the chart is resized on a narrow screen.
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return;
    const svgPoint = point.matrixTransform(screenMatrix.inverse());
    const index = Math.floor((svgPoint.x - padding) / calculatedBarWidth);

    if (index >= 0 && index < yearDistances.length) {
      setHoveredYear(yearDistances[index].year);
    }
  };

  const handleChartPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    updateHoveredYearFromPointer(e);
  };

  const handleChartClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const svg = svgRef.current;
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const screenMatrix = svg.getScreenCTM();
    if (!screenMatrix) return;
    const svgPoint = point.matrixTransform(screenMatrix.inverse());
    const index = Math.floor((svgPoint.x - padding) / calculatedBarWidth);
    if (index >= 0 && index < yearDistances.length) {
      const year = yearDistances[index].year;
      onSelectedYearChange(selectedYear === year ? null : year);
    }
  };
  
  // Update tooltip position when hoveredIndex changes
  useEffect(() => {
    if (hoveredIndex < 0 || !containerRef.current || !svgRef.current) {
      return;
    }

    const svgRect = svgRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    
    // Bar center in SVG viewBox coordinates
    const barCenterSvgX = padding + hoveredIndex * calculatedBarWidth + calculatedBarWidth / 2;
    
    // Convert SVG viewBox coordinate to SVG element's pixel coordinate
    const scale = svgRect.width / viewBoxWidth;
    const barCenterPixelX = barCenterSvgX * scale;
    
    // Convert to container-relative position
    const tooltipPos = svgRect.left - containerRect.left + barCenterPixelX;
    
    setTooltipXPosition(tooltipPos);
  }, [hoveredIndex, calculatedBarWidth, yearDistances.length, viewBoxWidth]);

  return (
    <div style={{ marginTop: '20px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: 'inherit' }}>Distance per Year</h3>
      {yearDistances.length === 0 ? (
        <div 
          style={{ 
            backgroundColor: '#fafafa', 
            borderRadius: '4px', 
            padding: '12px',
            height: '150px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#999',
            fontSize: '0.9rem'
          }}
        >
          Loading chart data...
        </div>
      ) : (
      <div className="analytics-chart" 
        ref={containerRef}
        style={{ 
          position: 'relative', 
          backgroundColor: '#fafafa', 
          borderRadius: '4px', 
          padding: '12px',
          paddingLeft: '36px',
          paddingTop: `${tooltipHeight}px`,
          overflow: 'visible'
        }}
      >
        {/* Y-axis labels positioned outside SVG */}
        <div
          style={{
            position: 'absolute',
            left: '4px',
            top: `calc(${tooltipHeight}px + ${chartHeight - padding}px - 13px)`,
            fontSize: '11px',
            color: '#999',
            width: '36px',
            textAlign: 'right',
            lineHeight: '1'
          }}
        >
          0
        </div>
        <div
          style={{
            position: 'absolute',
            left: '4px',
            top: `calc(${tooltipHeight}px + ${padding}px)`,
            fontSize: '11px',
            color: '#999',
            width: '36px',
            textAlign: 'right',
            lineHeight: '1'
          }}
        >
          {maxDistance.toFixed(0)}
        </div>
        <svg 
          ref={svgRef}
          width="100%" 
          height={chartHeight}
          viewBox={`0 0 ${viewBoxWidth} ${chartHeight}`}
          onPointerDown={handleChartPointerDown}
          onClick={handleChartClick}
          onPointerMove={updateHoveredYearFromPointer}
          onPointerUp={() => setHoveredYear(null)}
          onPointerCancel={() => setHoveredYear(null)}
          onMouseLeave={() => setHoveredYear(null)}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onTouchCancel={(e) => e.stopPropagation()}
          style={{ display: 'block', touchAction: 'none' }}
        >

          {yearDistances.map((item, index) => {
            const barHeight = (item.distance / maxDistance) * innerHeight;
            const x = padding + index * calculatedBarWidth + calculatedBarWidth * 0.1;
            const y = chartHeight - padding - barHeight;
            const otherHovered = activeYear !== null && activeYear !== item.year;

            return (
              <g key={item.year}>
                {/* Invisible hit area for hovering (full column height) */}
                <rect
                  x={padding + index * calculatedBarWidth}
                  y={padding}
                  width={calculatedBarWidth}
                  height={innerHeight}
                  fill="transparent"
                  style={{ cursor: interactive ? 'pointer' : 'default' }}
                />
                {/* Actual bar */}
                <rect
                  x={x}
                  y={y}
                  width={calculatedBarWidth * 0.8}
                  height={barHeight}
                  fill={barColor}
                  opacity={otherHovered ? 0.5 : 1}
                  style={{ transition: 'opacity 100ms ease, fill 150ms ease', pointerEvents: 'none' }}
                />
                {/* Year label - show based on labelInterval to avoid crowding */}
                {index % labelInterval === 0 && (
                  <text 
                    x={x + calculatedBarWidth * 0.4} 
                    y={chartHeight - padding + 15} 
                    textAnchor="middle" 
                    fontSize="12" 
                    fill="#666"
                    pointerEvents="none"
                  >
                    {item.year}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        
        {/* Tooltip positioned above the chart with overflow visible */}
        {hoveredData != null && (
          <div
            style={{
              position: 'absolute',
              top: '-10px',
              left: `${tooltipXPosition}px`,
              transform: 'translateX(-50%)',
              backgroundColor: '#333',
              color: 'white',
              padding: '8px 10px',
              borderRadius: '4px',
              fontSize: '12px',
              whiteSpace: 'nowrap',
              zIndex: 10,
              pointerEvents: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
              transition: 'left 150ms',
              textAlign: 'center',
            }}
          >
            <div style={{ fontWeight: 'bold', lineHeight: '1.4' }}>{hoveredYear}</div>
            <div style={{ lineHeight: '1.4' }}>{hoveredData.distance.toFixed(1)} km</div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export function AnalyticsPanel({ onGoBack, trips, isReadOnly, onUpdateTrip, onOpenSegmentInfo, onFocusSegment, timeSliderVisible, onToggleTimeSlider, selection, onSelectionChange, countryData, countryLoading, countryError, onRetryCountries }: AnalyticsPanelProps) {
  const selectedModeKey = selection.mode;
  const onSelectedModeKeyChange = (mode: string | null) => onSelectionChange({ ...selection, mode });
  const selectedYear = selection.year;
  const timeRange = selection.range;
  const [customModes] = useState<CustomOtherMode[]>(() => getCustomOtherModes());
  const yearlyDistances = useMemo(() => selection.countries ? countryYearDistances(trips, selection, countryData) : getDistancePerYear(trips, selectedModeKey), [trips, selection, countryData, selectedModeKey]);
  const maxYearlyDistance = Math.max(1, ...yearlyDistances.map(d => d.distance));
  const countryRows = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const trip of trips) {
      if (!tripIntersects(trip, timeRange)) continue;
      for (const segment of trip.segments) {
        const result = countryData?.results[segmentKey(trip.id, segment.id)];
        for (const [code, distance] of Object.entries(result?.distanceKmByCountry || {})) {
          if (distance > 0) totals[code] = (totals[code] || 0) + distance * tripFraction(trip, timeRange);
        }
      }
    }
    if (selection.country && !totals[selection.country]) totals[selection.country] = 0;
    return Object.entries(totals).sort(([, a], [, b]) => b - a).map(([code, distance]) => ({ code, distance, name: code === UNASSIGNED ? 'Unassigned' : countryData?.index.countries.find(c => c.code === code)?.name || code }));
  }, [trips, countryData, timeRange, selection.country]);

  const { globalDistanceByMode, segmentsByMode } = useMemo(() => {
    const distanceByMode: Record<string, number> = {};
    const segmentsByModeLocal: Record<string, SegmentEntry[]> = {};

    trips.forEach(trip => {
      const summary = trip.tripDistanceSummary;
      if (!selection.countries && summary?.distanceByMode) {
        for (const [mode, dist] of Object.entries(summary.distanceByMode)) {
           distanceByMode[mode] = (distanceByMode[mode] || 0) + (dist as number);
        }
      }

      trip.segments.forEach(segment => {
        if (segment.routingProfile === 'teleport') return;
        if (selection.countries && (!tripIntersects(trip, timeRange) || !selectedDistance(trip, segment, selection.country, countryData))) return;
        const key = getModeKeyForSegment(segment);
        if (selection.countries) distanceByMode[key] = (distanceByMode[key] || 0) + selectedDistance(trip, segment, selection.country, countryData) * tripFraction(trip, timeRange);
        if (!segmentsByModeLocal[key]) {
          segmentsByModeLocal[key] = [];
        }
        segmentsByModeLocal[key].push({ trip, segment });
      });
    });

    return { globalDistanceByMode: distanceByMode, segmentsByMode: segmentsByModeLocal };
  }, [trips, selection.countries, selection.country, timeRange, countryData]);

  const modeRows = useMemo(() => {
    return Object.entries(globalDistanceByMode)
      .sort(([, a], [, b]) => b - a)
      .map(([modeKey, distance]) => {
        const isOther = modeKey.startsWith('other:');
        const actualMode = isOther ? 'other' : modeKey;
        const targetIcon = isOther ? modeKey.split(':')[1] : undefined;
        const segmentEntries = segmentsByMode[modeKey] || [];
        let color = getModeAndIconColor(actualMode as TransportMode, targetIcon || '');

        if (isOther && targetIcon) {
          const allColors = segmentEntries
            .map(({ segment }) => segment.customColor)
            .filter((value): value is string => typeof value === 'string' && value !== '');
          if (allColors.length > 0 && new Set(allColors).size === 1) {
            color = allColors[0]!;
          }
        }

        return {
          modeKey,
          actualMode,
          targetIcon,
          displayName: getModeLabel(modeKey, customModes),
          distance,
          color,
          segmentEntries
        };
      });
  }, [customModes, globalDistanceByMode, segmentsByMode]);

  const selectedSegments = useMemo(() => {
    if (!selectedModeKey) return [] as SegmentEntry[];
    const selected = [...(segmentsByMode[selectedModeKey] || [])];

    const getTripSortTime = (trip: Trip) => {
      const date = trip.endDate || trip.startDate;
      return date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY;
    };

    const yearFiltered = selected.filter(({ trip }) => tripIntersects(trip, timeRange));

    yearFiltered.sort((left, right) => {
      const tripTimeDelta = getTripSortTime(right.trip) - getTripSortTime(left.trip);
      if (tripTimeDelta !== 0) return tripTimeDelta;

      if (left.trip.id !== right.trip.id) {
        return (right.trip.name || '').localeCompare(left.trip.name || '');
      }

      const leftIndex = left.trip.segments.findIndex(segment => segment.id === left.segment.id);
      const rightIndex = right.trip.segments.findIndex(segment => segment.id === right.segment.id);
      return rightIndex - leftIndex;
    });

    return yearFiltered;
  }, [selectedModeKey, timeRange, segmentsByMode]);

  const clearModeFilter = () => {
    onSelectedModeKeyChange(null);
  };

  const getSelectedModeColor = () => {
    if (!selectedModeKey) return undefined;
    
    const isOther = selectedModeKey.startsWith('other:');
    const actualMode = isOther ? 'other' : selectedModeKey;
    const targetIcon = isOther ? selectedModeKey.split(':')[1] : undefined;
    
    let color = getModeAndIconColor(actualMode as TransportMode, targetIcon || '');

    // For custom other modes, check if all segments have the same color
    if (isOther && targetIcon) {
      const segmentEntries = segmentsByMode[selectedModeKey] || [];
      const allColors = segmentEntries
        .map(({ segment }) => segment.customColor)
        .filter((value): value is string => typeof value === 'string' && value !== '');
      if (allColors.length > 0 && new Set(allColors).size === 1) {
        color = allColors[0]!;
      }
    }
    
    return color;
  };

  const handleModeClick = (modeKey: string) => {
    if (selectedModeKey === modeKey) {
      onSelectedModeKeyChange(null);
      return;
    }
    onSelectedModeKeyChange(modeKey);
  };

  useEffect(() => {
    if (selectedModeKey) {
      const baseConfigId = getActiveStyleConfigId();
      const baseConfig = getStyleConfigs().find(config => config.id === baseConfigId) || getResolvedActiveStyleConfig();
      const filteredConfig = buildTransportModeFilterStyleConfig(baseConfig, selectedModeKey);
      setTransientStyleConfig(filteredConfig);
    } else {
      clearTransientStyleConfig();
    }
    
    return () => {
      clearTransientStyleConfig();
    };
  }, [selectedModeKey, setTransientStyleConfig, clearTransientStyleConfig]);

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack} title="Close Analytics">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', flex: 1, textAlign: 'center' }}>Analytics</h2>
        <button className={`iconButton ${selection.countries ? 'active' : ''}`} aria-label="Group by country" aria-pressed={selection.countries} onClick={() => onSelectionChange({ ...selection, countries: !selection.countries, country: null, mode: null })} title="Group by country">
          <MaterialIcon name="public" size={20} />
        </button>
        <button className={`iconButton ${timeSliderVisible ? 'active' : ''}`} onClick={onToggleTimeSlider} title="Toggle time filter">
          <MaterialIcon name="line_end_circle" size={20} />
        </button>
      </div>

      <div className="content" style={{ padding: '16px', overflowY: 'auto' }}>
        {selection.countries && (
          <div className="country-list" aria-label="Countries">
            {countryLoading && <p role="status">Calculating country distances…</p>}
            {countryError && <p role="alert">{countryError} <button type="button" onClick={onRetryCountries}>Retry</button></p>}
            {!countryLoading && !countryError && countryRows.filter(row => !selection.country || selection.country === row.code).map(row => (
              <button type="button" className="country-row" key={row.code} aria-pressed={selection.country === row.code} onClick={() => onSelectionChange({ ...selection, country: selection.country === row.code ? null : row.code, mode: null })}>
                <span>{row.name}</span><span>{row.distance.toFixed(1)} km</span>
              </button>
            ))}
            {!countryLoading && !countryError && countryRows.length === 0 && <p>No countries in this period.</p>}
            {countryData && <p className="country-attribution"><a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noreferrer">{countryData.index.attribution}</a></p>}
          </div>
        )}
        {(
          <>
            {(!selection.countries || selection.country) && (
            <div className="trip-summary-table" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', borderBottom: '1px solid #dee2e6', padding: '4px 0', fontSize: '0.85rem', fontWeight: 'bold' }}>
                <div>Mode</div>
                <div style={{ textAlign: 'right' }}>Distance (km)</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>
                {modeRows.map(row => {
                  const collapsed = selectedModeKey !== null && selectedModeKey !== row.modeKey;

                  return (
                    <div
                      key={row.modeKey}
                      className="trip-summary-row"
                      onClick={() => handleModeClick(row.modeKey)}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 120px',
                        alignItems: 'center',
                        borderBottom: `${collapsed ? '0px' : '1px'} solid #f1f3f5`,
                        cursor: 'pointer',
                        overflow: 'hidden',
                        maxHeight: collapsed ? '0px' : '44px',
                        padding: collapsed ? '0px' : '6px 0',
                        opacity: collapsed ? 0 : 1,
                        transform: collapsed ? 'translateY(-4px)' : 'translateY(0)',
                        transition: 'max-height 220ms ease, opacity 180ms ease, transform 180ms ease, padding 220ms ease, background-color 180ms ease'
                      }}
                    >
                      <div className="trip-summary-td" style={{ padding: '0 8px 0 0', fontSize: '0.85rem' }}>
                        <span style={{ color: row.color }}>
                          {row.targetIcon && row.actualMode === 'other' ? <MaterialIcon name={row.targetIcon} size={18} /> : getModeIcon(row.actualMode as any, 18)}
                        </span>
                        <span style={{ textTransform: 'capitalize' }}>{row.displayName}</span>
                      </div>
                      <div className="trip-summary-td right" style={{ padding: '0', fontSize: '0.85rem', fontWeight: 500 }}>
                        {row.distance.toFixed(1)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            )}

            <YearlyDistanceChart yearDistances={yearlyDistances} maxDistance={maxYearlyDistance} modeColor={getSelectedModeColor()} selectedYear={selectedYear} onSelectedYearChange={year => {
              const range: [number, number] | null = year === null ? null : [new Date(year, 0, 1).getTime(), new Date(year, 11, 31, 23, 59, 59, 999).getTime()];
              onSelectionChange({ ...selection, year, range }, true);
            }} interactive />

            {selectedModeKey && (
              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: 'inherit', textTransform: 'capitalize' }}>{modeRows.find(row => row.modeKey === selectedModeKey)?.displayName} Segments</h3>
                  <button
                    type="button"
                    onClick={clearModeFilter}
                    style={{ border: 'none', background: 'none', color: '#1976d2', cursor: 'pointer', padding: 0, fontSize: '0.9rem' }}
                  >
                    <MaterialIcon name="close" size={16} />
                  </button>
                </div>

                {selectedSegments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {selectedSegments.map(({ trip, segment }) => {
                      const modeKey = getModeKeyForSegment(segment);
                      const isOther = modeKey.startsWith('other:');
                      const targetIcon = isOther ? modeKey.split(':')[1] : undefined;
                      const labelColor = getModeAndIconColor((isOther ? 'other' : segment.transportMode) as TransportMode, targetIcon || '');

                      return (
                        <div
                          key={`${trip.id}:${segment.id}`}
                          className="trip-card"
                          style={{
                            padding: '10px 12px',
                            cursor: 'default',
                            boxShadow: 'none',
                            minHeight: 'unset'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                              <span style={{ color: labelColor, display: 'inline-flex', flexShrink: 0 }}>
                                {isOther && targetIcon ? <MaterialIcon name={targetIcon} size={18} /> : getModeIcon(segment.transportMode as any, 18)}
                              </span>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <textarea
                                  key={`${segment.id}:${segment.name || ''}`}
                                  aria-label="Segment title"
                                  className="analytics-segment-title"
                                  defaultValue={segment.name || ''}
                                  placeholder="Untitled segment"
                                  disabled={isReadOnly}
                                  rows={1}
                                  onKeyDown={event => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      event.currentTarget.blur();
                                    }
                                  }}
                                  onBlur={event => {
                                    const name = event.currentTarget.value.trim();
                                    if (name !== (segment.name || '')) {
                                      onUpdateTrip({
                                        ...trip,
                                        segments: trip.segments.map(item => item.id === segment.id ? { ...item, name } : item)
                                      });
                                    }
                                  }}
                                  style={{
                                    display: 'block',
                                    width: '100%',
                                    minWidth: 0,
                                    boxSizing: 'border-box',
                                    padding: 0,
                                    border: 'none',
                                    outline: 'none',
                                    resize: 'none',
                                    overflow: 'hidden',
                                    background: 'transparent',
                                    color: 'inherit',
                                    font: 'inherit',
                                    fontWeight: 600,
                                    lineHeight: 1.3,
                                    cursor: isReadOnly ? 'default' : 'text',
                                    borderRadius: '4px',
                                  }}
                                />
                                <div style={{ fontSize: '0.8rem', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {trip.name || 'Untitled trip'}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="iconButton"
                              title="Focus segment on map"
                              onClick={() => onFocusSegment(trip.id, segment.id)}
                              style={{ padding: 0, flexShrink: 0 }}
                            >
                              <MaterialIcon name="my_location" size={18} />
                            </button>
                            <button
                              type="button"
                              className="iconButton"
                              title="Open segment info"
                              onClick={() => onOpenSegmentInfo(trip.id, segment.id)}
                              style={{ padding: 0, flexShrink: 0 }}
                            >
                              <MaterialIcon name="info" size={18} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p style={{ color: '#777' }}>No segments found for this transport mode.</p>
                )}
              </div>
            )}
          </>
        )}
        {trips.length === 0 && <p>No trips to analyze.</p>}
      </div>
    </>
  );
}
