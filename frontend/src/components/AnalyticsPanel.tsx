import { useEffect, useMemo, useState } from 'react';
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

export function AnalyticsPanel({ onGoBack, trips, onOpenSegmentInfo, onFocusSegment }: AnalyticsPanelProps) {
  const [customModes] = useState<CustomOtherMode[]>(() => getCustomOtherModes());
  const [selectedModeKey, setSelectedModeKey] = useState<string | null>(null);

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
