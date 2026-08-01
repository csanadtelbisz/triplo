import { useState, useEffect } from 'react';
import { MaterialIcon } from './MaterialIcon';
import { routingManager } from '../routing/RoutingService';
import type { ApiKeyTestResult } from '../routing/RoutingService';
import { MAP_STYLES, getMapStyleUrl } from '../config/mapStyles';
import { persistingManager } from '../persisting/PersistingManager';

import type { Trip } from '../../../shared/types';
import { PersistingConfigDialog } from './PersistingConfigDialog';
import { ApiKeyDialog } from './ApiKeyDialog';
import type { ApiKeyServiceConfiguration } from '../utils/apiKeyPreferences';

interface StatusPanelProps {
  onGoBack: () => void;
  trips: Trip[];
  onUpdateTrips?: (trips: Trip[]) => void;
}

export function StatusPanel({ onGoBack, trips, onUpdateTrips }: StatusPanelProps) {
  const services = routingManager.getServices();
  const persistingServices = persistingManager.getServices();

  const [mapStatuses, setMapStatuses] = useState<Record<string, 'pending' | 'success' | 'error'>>({});
  const [updateTick, setUpdateTick] = useState(0);
  const [configuringService, setConfiguringService] = useState<any>(null);
  const [apiKeyConfiguration, setApiKeyConfiguration] = useState<ApiKeyServiceConfiguration | null>(null);
  const [apiKeyTester, setApiKeyTester] = useState<((apiKey: string) => Promise<ApiKeyTestResult>) | undefined>();

  const openApiKeyConfiguration = (configuration: ApiKeyServiceConfiguration, tester?: (apiKey: string) => Promise<ApiKeyTestResult>) => {
    setApiKeyConfiguration(configuration);
    setApiKeyTester(() => tester);
  };

  const getApiKeyTester = (configuration: ApiKeyServiceConfiguration) => {
    const service = services.find(candidate => candidate.getApiKeyConfiguration?.()?.preferenceKey === configuration.preferenceKey);
    return service?.testApiKey?.bind(service);
  };

  const configurePersistingService = (service: any) => {
    if (service.isAvailable()) {
      setConfiguringService(service);
      return;
    }
    const instruction = service.getConnectionInstruction();
    instruction.onAction(() => setUpdateTick(Date.now()), () => setConfiguringService(service));
  };

  useEffect(() => {
    Object.keys(MAP_STYLES).forEach((key) => {
      let pingUrl = '';
      const styleUrl = getMapStyleUrl(key);
      if (typeof styleUrl === 'string') {
        pingUrl = styleUrl;
      } else {
        const sourceKeys = Object.keys(styleUrl.sources);
        if (sourceKeys.length > 0) {
          const source = styleUrl.sources[sourceKeys[0]];
          if (source.tiles && source.tiles.length > 0) {
            pingUrl = source.tiles[0].replace('{z}', '0').replace('{x}', '0').replace('{y}', '0');
          }
        }
      }

      if (pingUrl) {
        fetch(pingUrl, { method: 'HEAD' })
          .then(res => {
             setMapStatuses(prev => ({ ...prev, [key]: res.ok ? 'success' : 'error' }));
          })
          .catch(() => {
             setMapStatuses(prev => ({ ...prev, [key]: 'error' }));
          });
      } else {
        setMapStatuses(prev => ({ ...prev, [key]: 'error' }));
      }
    });

  }, [updateTick]);

  useEffect(() => {
    const refreshStatuses = () => setUpdateTick(Date.now());
    window.addEventListener('preferences-updated', refreshStatuses);
    return () => window.removeEventListener('preferences-updated', refreshStatuses);
  }, []);

  return (
    <>
      <div className="toolbar">
        <button className="iconButton" onClick={onGoBack} title="Go Back">
          <MaterialIcon name="arrow_back" size={20} />
        </button>
        <h2 className="status-panel-header-title">System Status</h2>
        <div className="status-panel-header-spacer"></div>
      </div>
      
      <div className="content status-panel-content">
        <h3 className="status-panel-section-title first">Persisting Services</h3>
        <div className="status-panel-list">
          {persistingServices.map((service: any, idx: number) => {
            const available = service.isAvailable();
            const instruction = service.getConnectionInstruction();
            return (
              <div key={idx} className={`status-panel-card ${available ? 'configurable' : ''}`} onClick={available ? () => configurePersistingService(service) : undefined}>
                <div className={`status-panel-card-header ${!available ? 'with-margin' : 'no-margin'}`}>
                  <div className="status-panel-card-title-container">
                    <img
                      src={service.icon} 
                      alt={`${service.name} icon`}
                      width={20}
                      height={20}
                      style={{
                        filter: available ? 'none' : 'grayscale(100%)',
                        opacity: available ? 1 : 0.6,
                        objectFit: 'contain',
                        display: 'block'
                      }}
                    />
                    <span className="status-panel-card-title">{service.name}</span>
                  </div>
                  {available ? (
                    <span className="status-panel-badge success">Connected</span>
                  ) : (
                    <span className="status-panel-badge unavailable">Unavailable</span>
                  )}
                </div>
                {!available && (
                  <div className="status-panel-attribution" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span dangerouslySetInnerHTML={{ __html: instruction.htmlDescription }} />
                  </div>
                )}
                {!available && (
                  <button className="dialog-btn dialog-btn-primary status-panel-configure-button" onClick={() => configurePersistingService(service)}>
                    Configure {service.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <h3 className="status-panel-section-title second">Routing Services</h3>
        <div className="status-panel-list">
          {services.map((service: any, idx: number) => {
            const available = service.isAvailable();
            const attr = service.getAttribution();
            const configuration = service.getApiKeyConfiguration?.();
            return (
              <div key={idx} className={`status-panel-card ${configuration && available ? 'configurable' : ''}`} onClick={configuration && available ? () => openApiKeyConfiguration(configuration, service.testApiKey?.bind(service)) : undefined}>
                <div className={`status-panel-card-header ${attr ? 'with-margin' : 'no-margin'}`}>
                  <div className="status-panel-card-title-container">
                    {service.icon ? (
                      <img
                        src={service.icon}
                        alt={`${service.name} icon`}
                        width={20}
                        height={20}
                        style={{
                          filter: available ? 'none' : 'grayscale(100%)',
                          opacity: available ? 1 : 0.6,
                          objectFit: 'contain',
                          display: 'block'
                        }}
                      />
                    ) : (
                      <MaterialIcon
                        name={available ? 'check_circle' : 'cancel'}
                        size={20}
                        className={`status-panel-icon ${available ? 'success' : 'unavailable'}`}
                      />
                    )}
                    <span className="status-panel-card-title">{service.name}</span>
                  </div>
                  <span className={`status-panel-badge ${available ? 'success' : 'unavailable'}`}>
                    {available ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                {attr && (
                  <div className="status-panel-attribution">
                    {attr.link ? (
                      <a href={attr.link} target="_blank" rel="noreferrer">
                        {attr.text}
                      </a>
                    ) : (
                      <span>{attr.text}</span>
                    )}
                  </div>
                )}
                {!available && configuration && (
                  <button className="dialog-btn dialog-btn-primary status-panel-configure-button" onClick={(event) => { event.stopPropagation(); openApiKeyConfiguration(configuration, service.testApiKey?.bind(service)); }}>
                    Configure {service.name.replace(' Router', '')}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <h3 className="status-panel-section-title second">Map Tile Providers</h3>
        <div className="status-panel-list">
          {Object.entries(MAP_STYLES).map(([key, style]) => {
            const status = mapStatuses[key] || 'pending';
            const configuration = style.apiKeyConfiguration;
            const styleUrl = getMapStyleUrl(key);
            
            let htmlAttribution = style.attribution || '';
            if (!htmlAttribution && typeof styleUrl !== 'string') {
              const sourceKeys = Object.keys(styleUrl.sources);
              if (sourceKeys.length > 0 && styleUrl.sources[sourceKeys[0]].attribution) {
                htmlAttribution = styleUrl.sources[sourceKeys[0]].attribution;
              }
            }

            return (
              <div key={key} className={`status-panel-card ${configuration && status === 'success' ? 'configurable' : ''}`} onClick={configuration && status === 'success' ? () => openApiKeyConfiguration(configuration, getApiKeyTester(configuration)) : undefined}>
                <div className={`status-panel-card-header ${htmlAttribution ? 'with-margin' : 'no-margin'}`}>
                  <div className="status-panel-card-title-container">
                    {style.icon ? (
                      <img
                        src={style.icon}
                        alt={`${style.name} icon`}
                        width={20}
                        height={20}
                        style={{
                          filter: status === 'success' ? 'none' : 'grayscale(100%)',
                          opacity: status === 'success' ? 1 : 0.6,
                          objectFit: 'contain',
                          display: 'block'
                        }}
                      />
                    ) : (
                      <>
                        {status === 'pending' && <MaterialIcon name="hourglass_empty" size={20} className="status-panel-icon pending" />}
                        {status === 'success' && <MaterialIcon name="check_circle" size={20} className="status-panel-icon success" />}
                        {status === 'error' && <MaterialIcon name="cancel" size={20} className="status-panel-icon error" />}
                      </>
                    )}
                    <span className="status-panel-card-title">{style.name}</span>
                  </div>
                  <span className={`status-panel-badge ${status === 'success' ? 'success' : status === 'error' ? 'unavailable' : 'pending'}`}>
                    {status === 'pending' ? 'Pinging...' : status === 'success' ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                {htmlAttribution && (
                  <div 
                    className="status-panel-attribution"
                    dangerouslySetInnerHTML={{ __html: htmlAttribution }} 
                  />
                )}
                {status === 'error' && configuration && (
                  <button className="dialog-btn dialog-btn-primary status-panel-configure-button" onClick={(event) => { event.stopPropagation(); openApiKeyConfiguration(configuration, getApiKeyTester(configuration)); }}>
                    Configure {style.name}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <PersistingConfigDialog 
        service={configuringService} 
        trips={trips} 
        onClose={() => setConfiguringService(null)} 
        onUpdateTrips={onUpdateTrips}
      />
      <ApiKeyDialog key={apiKeyConfiguration?.preferenceKey} configuration={apiKeyConfiguration} testApiKey={apiKeyTester} onClose={() => { setApiKeyConfiguration(null); setApiKeyTester(undefined); }} />
    </>
  );
}
