import { useMemo, useState } from 'react';
import type { Trip, TransportMode } from '../../../shared/types';
import { MaterialIcon, getModeIcon } from './MaterialIcon';
import { getCustomOtherModes, getModeAndIconColor } from '../utils/customModesPreferences';
import type { CustomOtherMode } from '../utils/customModesPreferences';

interface AnalyticsPanelProps {
  onGoBack: () => void;
  trips: Trip[];
}

export function AnalyticsPanel({ onGoBack, trips }: AnalyticsPanelProps) {
  const [customModes] = useState<CustomOtherMode[]>(() => getCustomOtherModes());
  // No need for useEffect just for this

  const { globalDistanceByMode, totalGlobalDistance } = useMemo(() => {
    const distanceByMode: Record<string, number> = {};
    let totalDistance = 0;

    trips.forEach(trip => {
      const summary = trip.tripDistanceSummary;
      if (!summary) return;
      
      totalDistance += summary.totalDistance || 0;

      if (summary.distanceByMode) {
        for (const [mode, dist] of Object.entries(summary.distanceByMode)) {
           distanceByMode[mode] = (distanceByMode[mode] || 0) + (dist as number);
        }
      }
    });

    return { globalDistanceByMode: distanceByMode, totalGlobalDistance: totalDistance };
  }, [trips]);

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
        <h3 style={{ marginTop: 0, marginBottom: '16px', color: '#333' }}>Total Distance: {totalGlobalDistance.toFixed(1)} km</h3>

        {Object.keys(globalDistanceByMode).length > 0 ? (
          <table className="trip-summary-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #dee2e6', textAlign: 'left' }}>
                <th style={{ padding: '8px 8px 8px 0', color: '#555' }}>Mode</th>
                <th style={{ padding: '8px 0', textAlign: 'right', color: '#555' }}>Distance (km)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(globalDistanceByMode)
                .sort(([, a], [, b]) => b - a)
                .map(([mode, dist]) => {
                  const isOther = mode.startsWith('other:');
                  const actualMode = isOther ? 'other' : mode;
                  const targetIcon = isOther ? mode.split(':')[1] : undefined;
                  let color = getModeAndIconColor(actualMode as TransportMode, targetIcon || '');

                  let displayName = mode.replace('_', ' ');

                  if (isOther) {
                    displayName = targetIcon ? (customModes.find(m => m.icon === targetIcon)?.name || targetIcon.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')) : 'Other';

                    const matchingSegs = trips.flatMap(t => t.segments).filter(s => s.transportMode === 'other' && s.customIcon === targetIcon);
                    const allColors = matchingSegs.map(s => s.customColor).filter(c => typeof c === 'string' && c !== '');
                    if (allColors.length > 0 && new Set(allColors).size === 1) {
                      color = allColors[0]!;
                    }
                  }

                  return (
                    <tr key={mode} style={{ borderBottom: '1px solid #f1f3f5' }}>
                      <td style={{ padding: '8px 8px 8px 0', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: color, display: 'inline-flex' }}>
                            {isOther && targetIcon ? <MaterialIcon name={targetIcon} size={18} /> : getModeIcon(actualMode as any, 18)}
                            </span>
                            <span style={{ textTransform: 'capitalize' }}>{displayName}</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: '500', color: '#444' }}>
                        {dist.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        ) : (
          <p style={{ color: '#777', fontStyle: 'italic' }}>No distance data available.</p>
        )}
      </div>
    </div>
  );
}
