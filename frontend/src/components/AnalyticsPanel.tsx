import { segmentClimate } from '../climate/profiles';
import { useClimateSettings } from '../climate/useClimateSettings';
import { countryDistances } from '../countries/parts';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import type { Segment, Trip, TransportMode } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { getCustomOtherModes, getModeAndIconColor } from '../utils/customModesPreferences';
import type { CustomOtherMode } from '../utils/customModesPreferences';
import type { AnalyticsSelection } from '../countries/analytics';
import { analyticsGrouping, countryYearDistances, matchesAnalyticsSegment, selectedClimate, selectedDistance, tripFraction } from '../countries/analytics';
import { TripScatterPlot } from './TripScatterPlot';
import type { CountryData } from '../countries/types';
import { UNASSIGNED, segmentKey } from '../countries/types';
import { countryName } from '../countries/names';
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
  countryCurrentTrip?: string;
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

function YearlyDistanceChart({ yearDistances, maxDistance, modeColor, selectedYear, onSelectedYearChange, interactive, climate = false }: { climate?: boolean; yearDistances: YearDistance[]; maxDistance: number; modeColor?: string; selectedYear: number | null; onSelectedYearChange: (year: number | null) => void; interactive: boolean }) {
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
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: 'inherit' }}>{climate ? 'Climate Impact per Year (kg CO₂e)' : 'Distance per Year'}</h3>
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
          {climate ? 'No dated climate data.' : 'No dated distance data.'}
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
            <div style={{ lineHeight: '1.4' }}>{hoveredData.distance.toFixed(1)} {climate ? 'kg CO₂e' : 'km'}</div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export function AnalyticsPanel({ onGoBack, trips, isReadOnly, onUpdateTrip, onOpenSegmentInfo, onFocusSegment, timeSliderVisible, onToggleTimeSlider, selection, onSelectionChange, countryData, countryLoading, countryCurrentTrip, countryError, onRetryCountries }: AnalyticsPanelProps) {
  const climateSettings = useClimateSettings();
  const grouping = analyticsGrouping(selection);
  const climateValues = useMemo(() => {
    const values = new Map<string, number | undefined>();
    if (!selection.climate && grouping !== 'trips') return values;
    for (const trip of trips) for (const segment of trip.segments) {
      values.set(segmentKey(trip.id, segment.id), segmentClimate(trip, segment, climateSettings).result?.co2eKg);
    }
    return values;
  }, [trips, climateSettings, selection.climate, grouping]);
  const unavailableClimateCount = selection.climate || grouping === 'trips'
    ? trips.reduce((count, trip) => count + trip.segments.filter(segment => matchesAnalyticsSegment(trip, segment, { ...selection, climate: false }, countryData) && climateValues.get(segmentKey(trip.id, segment.id)) === undefined).length, 0) : 0;
  const metric = useCallback((trip: Trip, segment: Segment, country: string | null, data?: CountryData) => {
    if (!selection.climate) return selectedDistance(trip, segment, country, data);
    return selectedClimate(trip, segment, climateValues.get(segmentKey(trip.id, segment.id)) || 0, country, data);
  }, [selection.climate, climateValues]);
  const eligible = useCallback((trip: Trip, segment: Segment, filters = selection) => matchesAnalyticsSegment(trip, segment, filters, countryData, climateValues.get(segmentKey(trip.id, segment.id))), [selection, countryData, climateValues]);
  const toggleMetric = () => onSelectionChange({ ...selection, groupBy: grouping, climate: !selection.climate }, true);
  const cycleGrouping = () => {
    const views = ['modes', 'trips', 'countries'] as const;
    const next = views[(views.indexOf(grouping) + 1) % views.length];
    onSelectionChange({ ...selection, groupBy: next, countries: next === 'countries', trip: null, country: null, mode: null }, true);
  };
  const metricLabel = selection.climate ? 'Climate impact (kg CO₂e)' : 'Distance (km)';
  const selectedModeKey = selection.mode;
  const onSelectedModeKeyChange = (mode: string | null) => onSelectionChange({ ...selection, mode });
  const selectedYear = selection.year;
  const timeRange = selection.range;
  const [customModes] = useState<CustomOtherMode[]>(() => getCustomOtherModes());
  const yearlyDistances = useMemo(() => countryYearDistances(trips, selection, countryData, metric), [trips, selection, countryData, metric]);
  const maxYearlyDistance = Math.max(1, ...yearlyDistances.map(d => d.distance));
  const tripRows = useMemo(() => trips.map(trip => {
    let distance = 0, impact = 0, hasSegments = false, available = true;
    for (const segment of trip.segments) {
      const kg = climateValues.get(segmentKey(trip.id, segment.id));
      if (kg === undefined && matchesAnalyticsSegment(trip, segment, { ...selection, trip: null, climate: false }, countryData)) available = false;
      if (!eligible(trip, segment, { ...selection, trip: null })) continue;
      const fraction = tripFraction(trip, timeRange);
      if (fraction <= 0) continue;
      hasSegments = true;
      distance += selectedDistance(trip, segment, selection.country, countryData) * fraction;

      impact += selectedClimate(trip, segment, kg || 0, selection.country, countryData) * fraction;
    }
    return { trip, distance, impact, available, hasSegments };
  }).filter(row => row.hasSegments && (!selection.climate || row.impact > 0))
    .sort((a, b) => (selection.climate ? b.impact - a.impact : b.distance - a.distance) || a.trip.name.localeCompare(b.trip.name)), [trips, eligible, selection, timeRange, countryData, climateValues]);
  const countryRows = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const trip of trips) for (const segment of trip.segments) {
      if (!eligible(trip, segment, { ...selection, country: null })) continue;
      const result = countryData?.results[segmentKey(trip.id, segment.id)];
      for (const [code, distance] of Object.entries(result?.distanceKmByCountry || countryDistances(segment))) {
        if (distance > 0) totals[code] = (totals[code] || 0) + metric(trip, segment, code, countryData) * tripFraction(trip, timeRange);
      }
    }
    return Object.entries(totals).filter(([, distance]) => distance > 0)
      .sort(([a, distanceA], [b, distanceB]) => a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : distanceB - distanceA).map(([code, distance]) => {
        const country = countryData?.index.countries.find(c => c.code === code);
        return { code, distance, name: code === UNASSIGNED ? 'Unassigned' : country ? countryName(country) : code };
      });
  }, [trips, eligible, selection, countryData, timeRange, metric]);
  const { globalDistanceByMode, segmentsByMode } = useMemo(() => {
    const distanceByMode: Record<string, number> = {};
    const segmentsByModeLocal: Record<string, SegmentEntry[]> = {};
    for (const trip of trips) for (const segment of trip.segments) {
      if (!eligible(trip, segment, { ...selection, mode: null })) continue;
      const key = getModeKeyForSegment(segment);
      distanceByMode[key] = (distanceByMode[key] || 0) + metric(trip, segment, selection.country, countryData) * tripFraction(trip, timeRange);
      (segmentsByModeLocal[key] ||= []).push({ trip, segment });
    }
    return { globalDistanceByMode: distanceByMode, segmentsByMode: segmentsByModeLocal };
  }, [trips, eligible, selection, timeRange, countryData, metric]);

  const modeRows = useMemo(() => {
    const entries = Object.entries(globalDistanceByMode);
    if (selectedModeKey && !entries.some(([key]) => key === selectedModeKey)) entries.push([selectedModeKey, 0]);
    return entries
      .filter(([, value]) => !selection.climate || Number(value.toFixed(1)) > 0)
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
  }, [customModes, globalDistanceByMode, segmentsByMode, selectedModeKey, selection.climate]);

  const selectedSegments = useMemo(() => {
    if (!selectedModeKey) return [] as SegmentEntry[];
    const selected = [...(segmentsByMode[selectedModeKey] || [])];

    const getTripSortTime = (trip: Trip) => {
      const date = trip.endDate || trip.startDate;
      return date ? new Date(date).getTime() : Number.NEGATIVE_INFINITY;
    };

    const yearFiltered = selected;

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
  }, [selectedModeKey, segmentsByMode]);

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
  }, [selectedModeKey]);

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack} title="Close Analytics">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', flex: 1, textAlign: 'center' }}>Analytics</h2>
        <button className="iconButton" aria-label={selection.climate ? 'Show distance' : 'Show climate impact'} aria-pressed={!!selection.climate} title={selection.climate ? 'Climate impact — switch to distance' : 'Distance — switch to climate impact'} onClick={toggleMetric}><MaterialIcon name={selection.climate ? 'eco' : 'straighten'} size={20} /></button>
        <button className="iconButton" data-analytics-grouping={grouping} aria-label={`Analytics grouping: ${grouping === 'modes' ? 'Transport modes' : grouping === 'trips' ? 'Trips' : 'Countries'}`} title={`Group by ${grouping === 'modes' ? 'trip' : grouping === 'trips' ? 'country' : 'transport mode'}`} onClick={cycleGrouping}>
          <MaterialIcon name={grouping === 'modes' ? 'commute' : grouping === 'trips' ? 'route' : 'public'} size={20} />
        </button>
        <button className={`iconButton ${timeSliderVisible ? 'active' : ''}`} onClick={onToggleTimeSlider} title="Toggle time filter">
          <MaterialIcon name="line_end_circle" size={20} />
        </button>
      </div>

      <div className="content" style={{ padding: '16px', overflowY: 'auto' }}>
        {unavailableClimateCount > 0 && <p role="status">Climate totals exclude {unavailableClimateCount} unavailable segment estimates. Open their Climate Impact cards for details.</p>}
        {(
          <>
            {grouping === 'trips' && <div className="trip-summary-table analytics-summary-table" aria-label={selection.climate ? 'Trip climate impacts' : 'Trip distances'}>
              <div className="analytics-summary-header"><div>Trip{selection.trip && <button type="button" className="iconButton analytics-clear-filter" aria-label="Clear trip filter" onClick={() => onSelectionChange({ ...selection, trip: null, country: null, mode: null })}><MaterialIcon name="close" size={14} /></button>}</div><div className="analytics-summary-distance">{metricLabel}</div></div>
              <div className="analytics-summary-rows">{tripRows.filter(row => !selection.trip || row.trip.id === selection.trip).map(({ trip, distance, impact }) => <button type="button" className="trip-summary-row analytics-summary-row climate-trip-analytics-row" key={trip.id}
                aria-pressed={selection.trip === trip.id} onClick={() => onSelectionChange({ ...selection, trip: selection.trip === trip.id ? null : trip.id, country: null, mode: null })}>
                <span className="trip-summary-td analytics-summary-cell">{trip.name || 'Untitled trip'}</span>
                <span className="trip-summary-td right analytics-summary-cell">{(selection.climate ? impact : distance).toFixed(1)}</span>
              </button>)}</div>
              {tripRows.length === 0 && <p>No trips match these filters.</p>}
            </div>}
            {(grouping === 'countries' || (grouping === 'trips' && selection.trip)) && (
              <div className="country-list" aria-label="Countries">
                {countryLoading && countryCurrentTrip && <p role="status">Calculating country distances for {countryCurrentTrip}…</p>}
                {countryError && <p role="alert">Could not calculate country distances. <button type="button" onClick={onRetryCountries}>Retry</button></p>}
                <div className="trip-summary-table analytics-summary-table">
                  <div className="analytics-summary-header">
                    <div>Country ({countryRows.filter(row => row.code !== UNASSIGNED).length}){selection.country && <button type="button" className="iconButton analytics-clear-filter" aria-label="Clear country filter" onClick={() => onSelectionChange({ ...selection, country: null, ...(grouping === 'countries' ? { mode: null } : {}) })}><MaterialIcon name="close" size={14} /></button>}</div><div className="analytics-summary-distance">{metricLabel}</div>
                  </div>
                  <div className="analytics-summary-rows">
                    {countryRows.filter(row => !selection.country || selection.country === row.code).map(row => (
                      <button type="button" className="trip-summary-row analytics-summary-row country-row" key={row.code} aria-pressed={selection.country === row.code} onClick={() => onSelectionChange({ ...selection, country: selection.country === row.code ? null : row.code, ...(grouping === 'countries' ? { mode: null } : {}) })}>
                        <span className="trip-summary-td analytics-summary-cell">{row.name}</span><span className="trip-summary-td right analytics-summary-cell">{row.distance.toFixed(1)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {!countryLoading && !countryError && countryRows.length === 0 && <p>No countries in this period.</p>}
              </div>
            )}
            {grouping === 'trips' && !selection.trip && <TripScatterPlot points={tripRows.filter(row => row.available).map(row => ({ id: row.trip.id, name: row.trip.name || 'Untitled trip', distance: row.distance, impact: row.impact }))} />}
            {(grouping === 'modes' || (grouping === 'countries' && selection.country) || (grouping === 'trips' && selection.trip)) && (
            <div className="trip-summary-table analytics-summary-table" aria-label="Transport modes">
              <div className="analytics-summary-header">
                <div>Mode</div>
                <div className="analytics-summary-distance">{metricLabel}</div>
              </div>
              <div className="analytics-summary-rows">
                {modeRows.map(row => {
                  const collapsed = selectedModeKey !== null && selectedModeKey !== row.modeKey;

                  return (
                    <button type="button" aria-pressed={selectedModeKey === row.modeKey}
                      key={row.modeKey}
                      className={`trip-summary-row analytics-summary-row${collapsed ? ' is-collapsed' : ''}`}
                      onClick={() => handleModeClick(row.modeKey)}
                    >
                      <div className="trip-summary-td analytics-summary-cell">
                        <span style={{ color: row.color }}>
                          {row.targetIcon && row.actualMode === 'other' ? <MaterialIcon name={row.targetIcon} size={18} /> : getModeIcon(row.actualMode as any, 18)}
                        </span>
                        <span style={{ textTransform: 'capitalize' }}>{row.displayName}</span>
                      </div>
                      <div className="trip-summary-td right analytics-summary-cell">
                        {row.distance.toFixed(1)}
                      </div>
                    </button>
                  );
                })}
              </div>
              {modeRows.length === 0 && <p>No transport modes match these filters.</p>}
            </div>
            )}

            <YearlyDistanceChart climate={selection.climate} yearDistances={yearlyDistances} maxDistance={maxYearlyDistance} modeColor={getSelectedModeColor()} selectedYear={selectedYear} onSelectedYearChange={year => {
              const range: [number, number] | null = year === null ? null : [new Date(year, 0, 1).getTime(), new Date(year, 11, 31, 23, 59, 59, 999).getTime()];
              onSelectionChange({ ...selection, year, range }, true);
            }} interactive />

            {selectedModeKey && (
              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: 'inherit', textTransform: 'capitalize' }}>{getModeLabel(selectedModeKey, customModes)} Segments</h3>
                  <button
                    type="button"
                    aria-label="Clear transport mode filter" onClick={clearModeFilter}
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
