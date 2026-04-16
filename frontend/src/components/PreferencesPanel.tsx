import React, { useState } from 'react';
import { MaterialIcon } from './MaterialIcon';
import '../styles/StatusPanel.css';

interface PreferencesPanelProps {
  onGoBack: () => void;
  onSetHome: () => void;
  onZoomHome: () => void;
}

const PreferencesPanel: React.FC<PreferencesPanelProps> = ({ onGoBack, onSetHome, onZoomHome }) => {
  const [showSavedMsg, setShowSavedMsg] = useState(false);

  const handleSetHome = () => {
    onSetHome();
    setShowSavedMsg(true);
    setTimeout(() => setShowSavedMsg(false), 2000);
  };

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack} title="Go Back">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 className="status-panel-header-title">Preferences</h2>
        <div className="status-panel-header-spacer"></div>
      </div>

      <div className="content status-panel-content">
        <h3 className="status-panel-section-title first">Map Home Position</h3>      
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px 12px' }}>
          <span style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.4 }}>
            Set the default map view that loads when opening the application. Pan and zoom to your desired location, then click 'Set current view as home'. 
          </span>

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', width: '100%' }}>   
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={onZoomHome}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px', fontSize: '0.85rem' }}
            >
              <MaterialIcon name="home" size={16} />
              <span>Zoom to Home</span>
            </button>
            <button
              className="dialog-btn dialog-btn-secondary"
              onClick={handleSetHome}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', padding: '6px', fontSize: '0.85rem' }}
            >
              <MaterialIcon name="push_pin" size={16} />
              <span>{showSavedMsg ? "Home position saved successfully!" : "Set current view as home"}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default PreferencesPanel;
