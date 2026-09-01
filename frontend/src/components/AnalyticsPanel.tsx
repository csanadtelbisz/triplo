import { useEffect, useMemo, useState, useRef } from 'react';
import type { Segment, Trip, TransportMode } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { getCustomOtherModes, getModeAndIconColor } from '../utils/customModesPreferences';
import type { CustomOtherMode } from '../utils/customModesPreferences';
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
  onOpenSegmentInfo: (tripId: string, segmentId: string) => void;
  onFocusSegment: (tripId: string, segmentId: string) => void;
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

function getSegmentLabel(segment: Segment) {
  return segment.name || `Untitled segment`;
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
    const endDate = trip.endDate ? new Date(trip.endDate) : null;

    if (!startDate || !endDate) return;

    // Determine which years this trip spans
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

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

function YearlyDistanceChart({ yearDistances, maxDistance, modeColor }: { yearDistances: YearDistance[]; maxDistance: number; modeColor?: string }) {
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

  const hoveredIndex = hoveredYear !== null ? yearDistances.findIndex(d => d.year === hoveredYear) : -1;
  const hoveredData = hoveredYear !== null ? yearDistances[hoveredIndex] : null;
  
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
    const viewBoxWidth = Math.max(300, yearDistances.length * calculatedBarWidth + padding * 2);
    const scale = svgRect.width / viewBoxWidth;
    const barCenterPixelX = barCenterSvgX * scale;
    
    // Convert to container-relative position
    const tooltipPos = svgRect.left - containerRect.left + barCenterPixelX;
    
    setTooltipXPosition(tooltipPos);
  }, [hoveredIndex, calculatedBarWidth, yearDistances.length]);

  return (
    <div style={{ marginTop: '20px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#222' }}>Distance per Year</h3>
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
      <div 
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
          viewBox={`0 0 ${Math.max(300, yearDistances.length * calculatedBarWidth + padding * 2)} ${chartHeight}`}
          onMouseLeave={() => setHoveredYear(null)}
          style={{ display: 'block' }}
        >

          {yearDistances.map((item, index) => {
            const barHeight = (item.distance / maxDistance) * innerHeight;
            const x = padding + index * calculatedBarWidth + calculatedBarWidth * 0.1;
            const y = chartHeight - padding - barHeight;
            const otherHovered = hoveredYear !== null && hoveredYear !== item.year;

            return (
              <g key={item.year}>
                {/* Invisible hit area for hovering (full column height) */}
                <rect
                  x={padding + index * calculatedBarWidth}
                  y={padding}
                  width={calculatedBarWidth}
                  height={innerHeight}
                  fill="transparent"
                  onMouseEnter={() => setHoveredYear(item.year)}
                  style={{ cursor: 'pointer' }}
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
        {hoveredData !== null && (
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

export function AnalyticsPanel({ onGoBack, trips, onOpenSegmentInfo, onFocusSegment }: AnalyticsPanelProps) {
  const [customModes] = useState<CustomOtherMode[]>(() => getCustomOtherModes());
  const [selectedModeKey, setSelectedModeKey] = useState<string | null>(null);
  const [yearlyDistances, setYearlyDistances] = useState<YearDistance[]>([]);
  const [maxYearlyDistance, setMaxYearlyDistance] = useState<number>(1);

  const { globalDistanceByMode, segmentsByMode } = useMemo(() => {
    const distanceByMode: Record<string, number> = {};
    const segmentsByModeLocal: Record<string, SegmentEntry[]> = {};

    trips.forEach(trip => {
      const summary = trip.tripDistanceSummary;
      if (summary?.distanceByMode) {
        for (const [mode, dist] of Object.entries(summary.distanceByMode)) {
           distanceByMode[mode] = (distanceByMode[mode] || 0) + (dist as number);
        }
      }

      trip.segments.forEach(segment => {
        const key = getModeKeyForSegment(segment);
        if (!segmentsByModeLocal[key]) {
          segmentsByModeLocal[key] = [];
        }
        segmentsByModeLocal[key].push({ trip, segment });
      });
    });

    return { globalDistanceByMode: distanceByMode, segmentsByMode: segmentsByModeLocal };
  }, [trips]);

  // Async calculation of yearly distances
  useEffect(() => {
    // Use two requestAnimationFrames to ensure the UI renders before calculation
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(async () => {
        const yearDists = getDistancePerYear(trips, selectedModeKey);
        const maxDist = Math.max(1, ...yearDists.map(d => d.distance));
        setYearlyDistances(yearDists);
        setMaxYearlyDistance(maxDist);
      });
      return raf2;
    });

    return () => {
      cancelAnimationFrame(raf1);
    };
  }, [trips, selectedModeKey]);

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

    selected.sort((left, right) => {
      const tripTimeDelta = getTripSortTime(right.trip) - getTripSortTime(left.trip);
      if (tripTimeDelta !== 0) return tripTimeDelta;

      if (left.trip.id !== right.trip.id) {
        return (right.trip.name || '').localeCompare(left.trip.name || '');
      }

      const leftIndex = left.trip.segments.findIndex(segment => segment.id === left.segment.id);
      const rightIndex = right.trip.segments.findIndex(segment => segment.id === right.segment.id);
      return rightIndex - leftIndex;
    });

    return selected;
  }, [selectedModeKey, segmentsByMode]);

  const clearModeFilter = () => {
    setSelectedModeKey(null);
    clearTransientStyleConfig();
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
      clearModeFilter();
      return;
    }

    const baseConfigId = getActiveStyleConfigId();
    const baseConfig = getStyleConfigs().find(config => config.id === baseConfigId) || getResolvedActiveStyleConfig();
    const filteredConfig = buildTransportModeFilterStyleConfig(baseConfig, modeKey);
    setTransientStyleConfig(filteredConfig);
    setSelectedModeKey(modeKey);
  };

  useEffect(() => {
    return () => {
      clearTransientStyleConfig();
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: '#fdfdfd' }}>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack} title="Close Analytics">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 style={{ margin: 0, fontSize: '1.1rem', flex: 1, textAlign: 'center' }}>Analytics</h2>
        <div style={{ width: 28 }}></div>
      </div>

      <div className="content" style={{ padding: '16px', overflowY: 'auto' }}>
        {modeRows.length > 0 ? (
          <>
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

            <YearlyDistanceChart yearDistances={yearlyDistances} maxDistance={maxYearlyDistance} modeColor={getSelectedModeColor()} />

            {selectedModeKey && (
              <div style={{ marginTop: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: '#222', textTransform: 'capitalize' }}>{modeRows.find(row => row.modeKey === selectedModeKey)?.displayName} Segments</h3>
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
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 600, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {getSegmentLabel(segment)}
                                </div>
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
                  <p style={{ color: '#777', fontStyle: 'italic' }}>No segments found for this transport mode.</p>
                )}
              </div>
            )}
          </>
        ) : (
          <p style={{ color: '#777', fontStyle: 'italic' }}>No distance data available.</p>
        )}
      </div>
    </div>
  );
}
