import React, { useState, useEffect } from 'react';
import { MaterialIcon } from './MaterialIcon';
import type { RenderStyleConfig } from '../utils/mapStylesPreferences';
import { Dialog } from './Dialog';

interface StyleConfigPanelProps {
  config: RenderStyleConfig;
  onSave: (config: RenderStyleConfig) => void;
  onGoBack: () => void;
}

const StyleConfigPanel: React.FC<StyleConfigPanelProps> = ({ config, onSave, onGoBack }) => {
  const [name, setName] = useState(config.name);
  const [script, setScript] = useState(config.script);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('style-config-panel-open', { detail: true }));
    return () => {
      window.dispatchEvent(new CustomEvent('style-config-panel-open', { detail: false }));
    };
  }, []);

  const handleSave = () => {
    onSave({ ...config, name, script });
  };

  const handleGoBack = () => {
    handleSave();
    onGoBack();
  };

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={handleGoBack} title="Go Back">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 className="toolbar-title">Style Configuration</h2>
        <div className="toolbar-actions">
          <button 
            className="iconButton" 
            onClick={() => setShowInfo(true)} 
            title="Information"
          >
            <MaterialIcon name="info" size={20} />
          </button>
        </div>
      </div>

      <div className="content" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="form-group">
          <label className="form-label">Name</label>
          <input 
            type="text" 
            value={name} 
            onChange={e => setName(e.target.value)} 
            onBlur={handleSave}
            disabled={config.readonly}
            className="form-input"
          />
        </div>
        <div className="form-group" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <label className="form-label">
            Style Configuration Script
          </label>
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            onBlur={handleSave}
            disabled={config.readonly}
            className="form-textarea"
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: '13px',
              padding: '8px',
              resize: 'none',
              backgroundColor: config.readonly ? '#f5f5f5' : '#fff'
            }}
            spellCheck={false}
          />
        </div>
      </div>

      <Dialog isOpen={showInfo} title="Style Configuration Types" onClose={() => setShowInfo(false)} actions={<button className="dialog-btn dialog-btn-primary" onClick={() => setShowInfo(false)}>Close</button>}>
        <pre style={{ fontSize: '11px', whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', maxHeight: '60vh', overflowY: 'auto' }}>
{`export interface Waypoint {
  id: string; // UUID
  coordinates: [number, number]; // [lon, lat]
  name?: string;
  description?: string;
  date?: string; // ISO 8601
  icon?: string;
  picture?: string;
}

export type TransportMode = 'walk' | 'hike' | 'run' | 'bike' | 'car' | 'taxi' | 'bus' | 'rail' | 'subway' | 'flight' | 'ferry' | 'other';

export interface Segment {
  id: string; // UUID
  transportMode: TransportMode;
  routingProfile: string;
  source: 'router' | 'gpx' | 'manual';
  routingService: string;
  geometry: GeoJSON.LineString;
  waypoints: Waypoint[];
  name?: string;
  customColor?: string;
  customIcon?: string;
  isHidden?: boolean;
}

export interface StyleConfigurationContext {
  isNoTripSelected: boolean;
  showHiddenSegments: boolean;
  isReadOnly: boolean;
  selectedSegment: Segment | null;
  mapLayer: string;
  waypointInfo?: {
    isLastSegment: boolean;
    isLastInSeg: boolean;
    isBordering: boolean;
    isInSelectedSegment: boolean;
    segIndex: number;
    wpIndex: number;
    currSegColor: string;
  };
}`}
        </pre>
      </Dialog>
    </>
  );
};

export default StyleConfigPanel;
