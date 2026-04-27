import React, { useState, useEffect } from 'react';
import { MaterialIcon } from './MaterialIcon';
import '../styles/StatusPanel.css';
import { OSM_LANGUAGES, getLanguagePreferences, saveLanguagePreferences } from '../utils/languagePreferences';

interface PreferencesPanelProps {
  onGoBack: () => void;
  onSetHome: () => void;
  onZoomHome: () => void;
}

const PreferencesPanel: React.FC<PreferencesPanelProps> = ({ onGoBack, onSetHome, onZoomHome }) => {
  const [showSavedMsg, setShowSavedMsg] = useState(false);
  const [langPrefs, setLangPrefs] = useState<string[]>([]);
  const [addingLang, setAddingLang] = useState(false);
  const [selectedNewLang, setSelectedNewLang] = useState('');
  const [defaultReadOnly, setDefaultReadOnly] = useState(() => localStorage.getItem('defaultReadOnly') === 'true');

  useEffect(() => {
    setLangPrefs(getLanguagePreferences());
  }, []);

  const updatePrefs = (newPrefs: string[]) => {
    setLangPrefs(newPrefs);
    saveLanguagePreferences(newPrefs);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newPrefs = [...langPrefs];
    [newPrefs[index - 1], newPrefs[index]] = [newPrefs[index], newPrefs[index - 1]];
    updatePrefs(newPrefs);
  };

  const moveDown = (index: number) => {
    if (index === langPrefs.length - 1) return;
    const newPrefs = [...langPrefs];
    [newPrefs[index + 1], newPrefs[index]] = [newPrefs[index], newPrefs[index + 1]];
    updatePrefs(newPrefs);
  };

  const deleteLang = (index: number) => {
    const newPrefs = [...langPrefs];
    newPrefs.splice(index, 1);
    updatePrefs(newPrefs);
  };

  const handleAddSubmit = () => {
    if (selectedNewLang && !langPrefs.includes(selectedNewLang)) {
      updatePrefs([...langPrefs, selectedNewLang]);
    }
    setAddingLang(false);
    setSelectedNewLang('');
  };

  const handleSetHome = () => {
    onSetHome();
    setShowSavedMsg(true);
    setTimeout(() => setShowSavedMsg(false), 2000);
  };

  const handleToggleDefaultReadOnly = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setDefaultReadOnly(isChecked);
    localStorage.setItem('defaultReadOnly', isChecked ? 'true' : 'false');
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
        <h3 className="status-panel-section-title first">Default Read-Only Mode</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 8px 12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
            <input 
              type="checkbox" 
              checked={defaultReadOnly} 
              onChange={handleToggleDefaultReadOnly} 
              style={{ width: '16px', height: '16px', margin: 0, cursor: 'pointer' }}
            />
            Stay in read-only mode after loading trips
          </label>
        </div>

        <h3 className="status-panel-section-title">Map Home Position</h3>      
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

        <h3 className="status-panel-section-title">Language Preference</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px 12px' }}>
          <span style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.4 }}>
            Set the preferred language order for displaying POI names. The highest available translated name will be shown.
          </span>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px', fontSize: '0.85rem' }}>
            <tbody>
              {langPrefs.map((lang, idx) => {
                const langName = OSM_LANGUAGES.find(l => l.code === lang)?.name || lang;
                return (
                  <tr key={lang} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 4px' }}>{langName}</td>
                    <td style={{ padding: '6px 4px', width: '90px' }}>
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <button className="iconButton" style={{ padding: '2px' }} onClick={() => moveUp(idx)} disabled={idx === 0}><MaterialIcon name="arrow_upward" size={16} /></button>
                        <button className="iconButton" style={{ padding: '2px' }} onClick={() => moveDown(idx)} disabled={idx === langPrefs.length - 1}><MaterialIcon name="arrow_downward" size={16} /></button>
                        <button className="iconButton" style={{ padding: '2px', color: '#d32f2f' }} onClick={() => deleteLang(idx)}><MaterialIcon name="delete" size={16} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <td colSpan={2} style={{ padding: '6px 4px' }}>
                  {addingLang ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <select 
                        value={selectedNewLang} 
                        onChange={(e) => setSelectedNewLang(e.target.value)}
                        style={{ flex: 1, padding: '4px', fontSize: '0.85rem' }}
                      >
                        <option value="" disabled>Select language...</option>
                        {OSM_LANGUAGES.filter(l => !langPrefs.includes(l.code)).map(l => (
                          <option key={l.code} value={l.code}>{l.name}</option>
                        ))}
                      </select>
                      <button className="iconButton" style={{ padding: '2px', color: '#2e7d32' }} onClick={handleAddSubmit} disabled={!selectedNewLang}><MaterialIcon name="check" size={18} /></button>
                      <button className="iconButton" style={{ padding: '2px', color: '#d32f2f' }} onClick={() => { setAddingLang(false); setSelectedNewLang(''); }}><MaterialIcon name="close" size={18} /></button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setAddingLang(true)}
                      style={{ background: 'none', border: 'none', color: '#1976d2', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', padding: '4px 0', fontSize: '0.85rem' }}
                    >
                      <MaterialIcon name="add" size={16} /> Add Language
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </>
  );
};

export default PreferencesPanel;
