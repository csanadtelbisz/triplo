import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { MaterialIcon } from './MaterialIcon';
import { getApiKeyPreferences, saveApiKeyPreferences } from '../utils/apiKeyPreferences';
import type { ApiKeyServiceConfiguration } from '../utils/apiKeyPreferences';
import { syncPreferencesToCloud } from '../utils/preferencesSync';
import type { ApiKeyTestResult } from '../routing/RoutingService';

interface ApiKeyDialogProps {
  configuration: ApiKeyServiceConfiguration | null;
  testApiKey?: (apiKey: string) => Promise<ApiKeyTestResult>;
  onClose: () => void;
}

interface ApiKeyConfigurationSectionProps {
  configuration: ApiKeyServiceConfiguration;
  apiKey: string;
  onApiKeyChange: (apiKey: string) => void;
  testApiKey?: (apiKey: string) => Promise<ApiKeyTestResult>;
}

export function ApiKeyConfigurationSection({ configuration, apiKey, onApiKeyChange, testApiKey }: ApiKeyConfigurationSectionProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [testResult, setTestResult] = useState<ApiKeyTestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (!configuration || !testApiKey || !apiKey.trim()) {
      setTestResult(null);
      setIsTesting(false);
      return;
    }
    let active = true;
    setIsTesting(true);
    const timeout = window.setTimeout(async () => {
      const result = await testApiKey(apiKey.trim());
      if (!active) return;
      setTestResult(result);
      setIsTesting(false);
    }, 400);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [apiKey, configuration, testApiKey]);

  return (
      <div className="api-key-dialog-grid">
        <div>
          <label htmlFor={`api-key-${configuration.preferenceKey}`} style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>{configuration.inputLabel}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id={`api-key-${configuration.preferenceKey}`} type={showApiKey ? 'text' : 'password'} autoComplete="off" value={apiKey} onChange={event => onApiKeyChange(event.target.value)} placeholder="API key" style={{ flex: 1, minWidth: 0, padding: '8px', borderRadius: 4, border: '1px solid #ccc' }} />
            <button type="button" className="iconButton" onClick={() => setShowApiKey(visible => !visible)} title={showApiKey ? 'Hide API key' : 'Show API key'} aria-label={showApiKey ? 'Hide API key' : 'Show API key'}>
              <MaterialIcon name={showApiKey ? 'visibility_off' : 'visibility'} size={20} />
            </button>
          </div>
          {isTesting && <div className="api-key-test-status pending"><MaterialIcon name="sync" size={16} className="spinning" /> Testing API key…</div>}
          {!isTesting && testResult?.ok && <div className="api-key-test-status success"><MaterialIcon name="check_circle" size={16} /> API key tested</div>}
          {!isTesting && testResult && !testResult.ok && <div className="api-key-test-status warning"><MaterialIcon name="warning" size={16} /> {testResult.status ? `${testResult.status} ${testResult.message || 'Request failed'}` : testResult.message || 'API key test failed'}</div>}
        </div>
        <div>
          <strong>How to obtain your key</strong>
          <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {configuration.instructions.map((instruction, index) => (
              <li key={instruction}>{index === 0 ? <>Go to <a href={instruction.slice('Go to '.length)} target="_blank" rel="noreferrer">{instruction.slice('Go to '.length)}</a></> : instruction}</li>
            ))}
          </ol>
        </div>
      </div>
  );
}

export function ApiKeyDialog({ configuration, testApiKey, onClose }: ApiKeyDialogProps) {
  const [apiKey, setApiKey] = useState(() => configuration ? getApiKeyPreferences()[configuration.preferenceKey] : '');

  if (!configuration) return null;

  const save = () => {
    const preferences = getApiKeyPreferences();
    saveApiKeyPreferences({ ...preferences, [configuration.preferenceKey]: apiKey.trim() });
    syncPreferencesToCloud();
    window.dispatchEvent(new Event('preferences-updated'));
    onClose();
  };

  return (
    <Dialog isOpen title={`${configuration.serviceName} Configuration`} onClose={onClose} className="api-key-dialog" actions={<><button className="dialog-btn dialog-btn-cancel" onClick={onClose}>Cancel</button><button className="dialog-btn dialog-btn-primary" onClick={save}>Save</button></>}>
      <p style={{ margin: '0 0 20px', color: '#555', lineHeight: 1.5 }}>You need to specify your API key to use {configuration.serviceName}. The free tier should give you ample credits to use Triplo.</p>
      <ApiKeyConfigurationSection configuration={configuration} apiKey={apiKey} onApiKeyChange={setApiKey} testApiKey={testApiKey} />
      <p style={{ margin: '20px 0 0', color: '#7a5200', fontSize: '0.9rem', lineHeight: 1.4 }}><strong>Info:</strong> your API key is saved to your selected cloud storage as plain text. Only use trusted cloud storage.</p>
    </Dialog>
  );
}
