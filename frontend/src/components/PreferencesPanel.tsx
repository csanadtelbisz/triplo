import React, { useState, useEffect, useRef } from 'react';
import { MaterialIcon } from './MaterialIcon';
import '../styles/StatusPanel.css';
import { OSM_LANGUAGES, getLanguagePreferences, saveLanguagePreferences } from '../utils/languagePreferences';
import { getCustomOtherModes, saveCustomOtherModes, getShowCustomModesInDefault, setShowCustomModesInDefault } from '../utils/customModesPreferences';
import type { CustomOtherMode } from '../utils/customModesPreferences';
import { BUILT_IN_MODES, BUILT_IN_ICONS, getDefaultColor, getBuiltInModeOverrides, saveBuiltInModeOverrides } from '../utils/builtInModesPreferences';
import type { BuiltInModesOverrides } from '../utils/builtInModesPreferences';
import type { TransportMode } from '../../../shared/types';
import { routingManager } from '../routing/RoutingService';
import { syncPreferencesToCloud } from '../utils/preferencesSync';
import { getStyleConfigs, saveStyleConfigs, DEFAULT_STYLE_SCRIPT, setActiveStyleConfigId } from '../utils/mapStylesPreferences';
import type { RenderStyleConfig } from '../utils/mapStylesPreferences';
import StyleConfigPanel from './StyleConfigPanel';

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
  const [isSyncing, setIsSyncing] = useState(false);

  const [customModes, setCustomModes] = useState<CustomOtherMode[]>(() => getCustomOtherModes());
  const [showCustomModes, setShowCustomModes] = useState(() => getShowCustomModesInDefault());
  const [builtInOverrides, setBuiltInOverrides] = useState<BuiltInModesOverrides>(() => getBuiltInModeOverrides());

  const [styleConfigs, setStyleConfigs] = useState<RenderStyleConfig[]>(() => getStyleConfigs());
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
  const styleConfigsRef = useRef<HTMLElement | null>(null);

  const isIconUsed = (icon: string, currentIndex: number = -1) => {
    if (!icon) return false;
    const vIcon = icon.trim();
    if (Object.values(BUILT_IN_ICONS).includes(vIcon)) return true;
    for (let i = 0; i < customModes.length; i++) {
      if (i !== currentIndex && customModes[i].icon.trim() === vIcon) return true;
    }
    return false;
  };

  useEffect(() => {
    setLangPrefs(getLanguagePreferences());
    
    const handlePreferencesUpdated = () => {
      setLangPrefs(getLanguagePreferences());
      setCustomModes(getCustomOtherModes());
      setShowCustomModes(getShowCustomModesInDefault());
      setBuiltInOverrides(getBuiltInModeOverrides());
      setStyleConfigs(getStyleConfigs());
    };
    
    window.addEventListener('preferences-updated', handlePreferencesUpdated);
    return () => window.removeEventListener('preferences-updated', handlePreferencesUpdated);
  }, []);

  const updatePrefs = (newPrefs: string[]) => {
    setLangPrefs(newPrefs);
    saveLanguagePreferences(newPrefs);
    syncPreferencesToCloud();
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

  const handleManualSync = async () => {
    setIsSyncing(true);
    await syncPreferencesToCloud(true);
    setIsSyncing(false);
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

  const handleUpdateCustomModes = (newModes: CustomOtherMode[]) => {
    setCustomModes(newModes);
    saveCustomOtherModes(newModes);
    syncPreferencesToCloud();
  };

  const handleUpdateBuiltInMode = (mode: string, updates: any) => {
    const newOverrides = { ...builtInOverrides };
    const current = newOverrides[mode as keyof BuiltInModesOverrides] || {};
    const updated = { ...current, ...updates };

    if (updated.name === mode) delete updated.name;
    if (updated.color === getDefaultColor(mode as any)) delete updated.color;

    if (Object.keys(updated).length === 0) {
      delete newOverrides[mode as keyof BuiltInModesOverrides];
    } else {
      newOverrides[mode as keyof BuiltInModesOverrides] = updated;
    }

    setBuiltInOverrides(newOverrides);
    saveBuiltInModeOverrides(newOverrides);
    syncPreferencesToCloud();
  };

  const handleCustomModeIconBlur = (index: number, val: string) => {
    if (isIconUsed(val, index)) {
      const newModes = [...customModes];
      newModes[index] = { ...newModes[index], icon: '' };
      setCustomModes(newModes);
      saveCustomOtherModes(newModes);
      syncPreferencesToCloud();
    }
  };

  const handleToggleShowCustomModes = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.checked;
    setShowCustomModes(val);
    setShowCustomModesInDefault(val);
    syncPreferencesToCloud();
  };

  const handleAddCustomMode = () => {
    handleUpdateCustomModes([...customModes, { icon: '', name: '', color: '#000000', routingProfile: 'Straight Line Router|straight_line' }]);
  };

  const handleUpdateCustomMode = (index: number, updates: Partial<CustomOtherMode>) => {
    const newModes = [...customModes];
    newModes[index] = { ...newModes[index], ...updates };
    handleUpdateCustomModes(newModes);
  };

  const handleDeleteCustomMode = (index: number) => {
    const newModes = [...customModes];
    newModes.splice(index, 1);
    handleUpdateCustomModes(newModes);
  };

  const handleMoveStyleConfigUp = (index: number) => {
    if (index === 0) return;
    const newConfigs = [...styleConfigs];
    [newConfigs[index - 1], newConfigs[index]] = [newConfigs[index], newConfigs[index - 1]];
    setStyleConfigs(newConfigs);
    saveStyleConfigs(newConfigs);
  };

  const handleMoveStyleConfigDown = (index: number) => {
    if (index === styleConfigs.length - 1) return;
    const newConfigs = [...styleConfigs];
    [newConfigs[index + 1], newConfigs[index]] = [newConfigs[index], newConfigs[index + 1]];
    setStyleConfigs(newConfigs);
    saveStyleConfigs(newConfigs);
  };

  const handleDeleteStyleConfig = (index: number) => {
    const config = styleConfigs[index];
    if (config.readonly) return;
    const newConfigs = [...styleConfigs];
    newConfigs.splice(index, 1);
    setStyleConfigs(newConfigs);
    saveStyleConfigs(newConfigs);
  };

  const handleAddStyleConfig = () => {
    const newConfig: RenderStyleConfig = {
      id: crypto.randomUUID(),
      name: 'New Style Config',
      script: DEFAULT_STYLE_SCRIPT
    };
    const newConfigs = [...styleConfigs, newConfig];
    setStyleConfigs(newConfigs);
    saveStyleConfigs(newConfigs);
    setActiveStyleConfigId(newConfig.id);
    setEditingConfigId(newConfig.id);
  };

  const handleUpdateStyleConfig = (config: RenderStyleConfig) => {
    const index = styleConfigs.findIndex(c => c.id === config.id);
    if (index === -1) return;
    const newConfigs = [...styleConfigs];
    newConfigs[index] = config;
    setStyleConfigs(newConfigs);
    saveStyleConfigs(newConfigs);
  };

  const handleCloseEditor = () => {
    setEditingConfigId(null);
    // After returning to the preferences panel, scroll to the Style Configurations section
    // Use a short timeout so the panel content has rendered
    setTimeout(() => {
      if (styleConfigsRef.current) {
        styleConfigsRef.current.scrollIntoView({ block: 'start' });
      } else {
        const container = document.querySelector('.status-panel-content');
        if (container) (container as HTMLElement).scrollTo({ top: 0 });
      }
    }, 80);
  };

  if (editingConfigId) {
    const config = styleConfigs.find(c => c.id === editingConfigId);
    if (config) {
      return (
        <StyleConfigPanel
          config={config}
          onSave={(updated) => {
            handleUpdateStyleConfig(updated);
          }}
          onGoBack={handleCloseEditor}
        />
      );
    }
  }

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack} title="Go Back">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 className="status-panel-header-title">Preferences</h2>
        <div className="status-panel-header-spacer"></div>
        <button 
          className="iconButton" 
          onClick={handleManualSync} 
          title="Backup Preferences"
          disabled={isSyncing}
        >
          <MaterialIcon name={isSyncing ? "sync" : "backup"} size={20} className={isSyncing ? "rotating" : ""} />
        </button>
      </div>

      <div className="content status-panel-content">
        <h3 className="status-panel-section-title first">Default Read-Only Mode
          <span title="Not synced preference">
            <MaterialIcon name="cloud_off" size={16} style={{ marginLeft: '6px', verticalAlign: 'baseline' }} />
          </span>
        </h3>
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
                      <MaterialIcon name="add" size={16} /> Add language
                    </button>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 className="status-panel-section-title">Built-in Transport Modes</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px 12px' }}>
          <span style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.4 }}>
            Override the appearance and behavior of default system transport modes.
          </span>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px', fontSize: '0.85rem', tableLayout: 'fixed' }}>
            <tbody>
              {BUILT_IN_MODES.map((mode) => {
                const ovr = builtInOverrides[mode] || {};
                const dIcon = BUILT_IN_ICONS[mode];
                const dColor = getDefaultColor(mode);
                return (
                  <tr key={mode} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 4px', verticalAlign: 'middle', width: '32px', textAlign: 'center' }}>
                      <MaterialIcon name={dIcon} size={24} style={{ color: ovr.color || dColor }} />
                    </td>
                    <td style={{ padding: '6px 2px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                          <input type="text" value={ovr.name ?? mode} onChange={(e) => handleUpdateBuiltInMode(mode, { name: e.target.value })} style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} placeholder={mode} title="Override Name" />
                          <input type="text" value={dIcon} disabled style={{ width: '100px', flexShrink: 0, padding: '4px 6px', fontSize: '0.8rem', border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: '#f5f5f5', color: '#888' }} title="System Icon (Cannot be changed)" />
                          <input type="color" value={ovr.color || dColor} onChange={(e) => handleUpdateBuiltInMode(mode, { color: e.target.value })} style={{ width: '26px', flexShrink: 0, height: '26px', padding: '0 2px', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', boxSizing: 'border-box' }} title="Override Color" />
                        </div>
                        <select value={ovr.routingProfile || `${routingManager.getDefaultRouter(mode as TransportMode).serviceName}|${routingManager.getDefaultRouter(mode as TransportMode).profile}`} onChange={(e) => handleUpdateBuiltInMode(mode, { routingProfile: e.target.value })} style={{ width: '100%', padding: '4px 6px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} title="Override Default Routing Profile">
                          {routingManager.getServices().flatMap(svc => 
                            svc.getRoutingProfiles(mode as TransportMode).map(profile => (
                              <option key={`builtin-${svc.name}-${profile}`} value={`${svc.name}|${profile}`}>
                                {svc.name.replace(' Router', '')} [{profile}]
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3 className="status-panel-section-title">Other Transport Modes</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px 12px' }}>
          <span style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.4 }}>
            Define custom transport modes with an icon, name, color, and default routing profile.
            <a href="https://fonts.google.com/icons?icon.style=Rounded" target="_blank" rel="noreferrer" style={{ color: '#1976d2', textDecoration: 'none', marginLeft: '4px' }}>
              Search icons
            </a>
          </span>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px', fontSize: '0.85rem', tableLayout: 'fixed' }}>
            <tbody>
              {customModes.map((mode, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 4px', verticalAlign: 'middle', width: '32px', textAlign: 'center' }}>
                    <MaterialIcon name={mode.icon || 'help_outline'} size={24} style={{ color: mode.color }} />
                  </td>
                  <td style={{ padding: '6px 2px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' }}>
                      <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                        <input type="text" value={mode.name} onChange={(e) => handleUpdateCustomMode(idx, { name: e.target.value })} style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} placeholder="Name" title="Name" />
                        <input type="text" value={mode.icon} onChange={(e) => handleUpdateCustomMode(idx, { icon: e.target.value })} onBlur={(e) => handleCustomModeIconBlur(idx, e.target.value)} style={{ width: '100px', flexShrink: 0, padding: '4px 6px', fontSize: '0.8rem', border: '1px solid ' + (isIconUsed(mode.icon, idx) ? 'red' : '#ccc'), borderRadius: '4px', boxSizing: 'border-box', backgroundColor: isIconUsed(mode.icon, idx) ? '#ffebee' : 'transparent' }} placeholder="Icon ID" title={isIconUsed(mode.icon, idx) ? "Icon already in use" : "Material Icon ID"} />
                        <input type="color" value={mode.color} onChange={(e) => handleUpdateCustomMode(idx, { color: e.target.value })} style={{ width: '26px', flexShrink: 0, height: '26px', padding: '0 2px', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', boxSizing: 'border-box' }} title="Color" />
                      </div>
                      <select value={mode.routingProfile} onChange={(e) => handleUpdateCustomMode(idx, { routingProfile: e.target.value })} style={{ width: '100%', padding: '4px 6px', fontSize: '0.8rem', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' }} title="Default Routing Profile">
                        <option value="Straight Line Router|straight_line">Straight Line</option>
                        {routingManager.getServices().flatMap(svc => 
                          svc.getRoutingProfiles('other').map(profile => (
                            <option key={`${svc.name}|${profile}`} value={`${svc.name}|${profile}`}>
                              {svc.name.replace(' Router', '')} [{profile}]
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', verticalAlign: 'middle', width: '30px' }}>
                    <button className="iconButton" style={{ padding: '2px', color: '#d32f2f' }} onClick={() => handleDeleteCustomMode(idx)} title="Delete mode"><MaterialIcon name="delete" size={20} /></button>
                  </td>
                </tr>
              ))}
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <td colSpan={3} style={{ padding: '6px 4px' }}>
                  <button 
                    onClick={handleAddCustomMode}
                    style={{ background: 'none', border: 'none', color: '#1976d2', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', padding: '4px 0', fontSize: '0.85rem' }}
                  >
                    <MaterialIcon name="add" size={16} /> Add other transport mode
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '0 8px 12px', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
              <input type="checkbox" checked={showCustomModes} onChange={handleToggleShowCustomModes} style={{ width: '16px', height: '16px', margin: 0, cursor: 'pointer' }} />
              Show these extra modes among available transport modes
            </label>
          </div>
        </div>

        <h3 ref={styleConfigsRef as any} className="status-panel-section-title">Style Configurations</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '0 8px 12px' }}>
          <span style={{ fontSize: '0.85rem', color: '#666', lineHeight: 1.4 }}>
            Configure custom rendering styles for routes and pins.
          </span>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px', fontSize: '0.85rem' }}>
            <tbody>
              {styleConfigs.map((config, idx) => (
                <tr key={config.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '6px 4px', fontWeight: config.readonly ? 'bold' : 'normal' }}>
                    {config.name}
                  </td>
                  <td style={{ padding: '6px 4px', width: '120px' }}>
                    <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <button className="iconButton" style={{ padding: '2px' }} onClick={() => handleMoveStyleConfigUp(idx)} disabled={idx === 0}><MaterialIcon name="arrow_upward" size={16} /></button>
                      <button className="iconButton" style={{ padding: '2px' }} onClick={() => handleMoveStyleConfigDown(idx)} disabled={idx === styleConfigs.length - 1}><MaterialIcon name="arrow_downward" size={16} /></button>
                      <button className="iconButton" style={{ padding: '2px', color: '#1976d2' }} onClick={() => { setActiveStyleConfigId(config.id); setEditingConfigId(config.id); }} title="Edit"><MaterialIcon name="edit" size={16} /></button>
                      <button className="iconButton" style={{ padding: '2px', color: '#d32f2f', visibility: config.readonly ? 'hidden' : 'visible' }} onClick={() => handleDeleteStyleConfig(idx)} title="Delete" disabled={config.readonly}><MaterialIcon name="delete" size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <td colSpan={2} style={{ padding: '6px 4px' }}>
                  <button 
                    onClick={handleAddStyleConfig}
                    style={{ background: 'none', border: 'none', color: '#1976d2', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', padding: '4px 0', fontSize: '0.85rem' }}
                  >
                    <MaterialIcon name="add" size={16} /> Add configuration
                  </button>
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
