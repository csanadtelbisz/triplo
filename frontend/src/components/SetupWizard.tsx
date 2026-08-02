import { useState } from 'react';
import { Dialog } from './Dialog';
import { MaterialIcon } from './MaterialIcon';
import { ApiKeyConfigurationSection } from './ApiKeyDialog';
import { GRAPHHOPPER_API_CONFIGURATION, MAPY_API_CONFIGURATION, getApiKeyPreferences, saveApiKeyPreferences } from '../utils/apiKeyPreferences';
import { loadPreferencesFromCloud } from '../utils/preferencesSync';
import { syncPreferencesToCloud } from '../utils/preferencesSync';
import { persistingManager } from '../persisting/PersistingManager';
import { routingManager } from '../routing/RoutingService';

type SetupMode = 'new' | 'restore';
type Step = 'welcome' | 'fetching' | 'google-folder' | 'github' | 'api-keys';

export function SetupWizard({ onComplete, onStartBackgroundSync }: { onComplete: () => void; onStartBackgroundSync: () => void | Promise<void> }) {
  const persistingServices = persistingManager.getServices();
  const googleDriveService = persistingServices.find(service => service.name === 'Google Drive')!;
  const githubService = persistingServices.find(service => service.name === 'GitHub')!;

  const [step, setStep] = useState<Step>('welcome');
  const [mode, setMode] = useState<SetupMode>('new');
  const [folderName, setFolderName] = useState(() => localStorage.getItem('gdrive_folder_name') || 'Triplo Trips');
  const [repo, setRepo] = useState(() => localStorage.getItem('github_repo') || '');
  const [token, setToken] = useState(() => localStorage.getItem('github_token') || '');
  const [apiKeys, setApiKeys] = useState(getApiKeyPreferences);

  const continueAfterStorage = (currentMode = mode) => {
    const keys = getApiKeyPreferences();
    if (currentMode === 'new' || (!keys.mapyApiKey && !keys.graphHopperApiKey)) setStep('api-keys');
    else finish();
  };

  const fetchSetupAndContinue = async (selectedMode: SetupMode, connection: 'google' | 'github') => {
    setStep('fetching');
    void Promise.resolve(onStartBackgroundSync()).catch(error => {
      console.error('Background trip reload failed after authentication:', error);
    });

    await loadPreferencesFromCloud();

    if (connection === 'google') {
      const [existingTrips, existingPreferences] = await Promise.all([
        googleDriveService.load(),
        googleDriveService.loadPreferences?.()
      ]);

      if (selectedMode === 'restore' && existingTrips.length === 0 && !existingPreferences) {
        setStep('google-folder');
        return;
      }

      if (selectedMode === 'new') {
        setStep('google-folder');
        return;
      }
    }

    continueAfterStorage(selectedMode);
  };

  const finish = () => {
    syncPreferencesToCloud(true);
    onComplete();
  };

  const chooseGoogle = (selectedMode: SetupMode) => {
    googleDriveService?.getConnectionInstruction().onAction(async () => {
      await fetchSetupAndContinue(selectedMode, 'google');
    });
  };

  const saveGitHub = async () => {
    if (!repo.trim() || !token.trim()) return;
    localStorage.setItem('github_repo', repo.trim());
    localStorage.setItem('github_token', token.trim());
    await fetchSetupAndContinue(mode, 'github');
  };

  if (step === 'fetching') {
    return <Dialog isOpen title="Fetching setup" onClose={onComplete} className="setup-dialog">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <MaterialIcon name="sync" size={24} className="spinning" />
        <div>
          <p style={{ margin: 0 }}>Please wait while Triplo loads your setup.</p>
          <small>Trip sync starts automatically in the background.</small>
        </div>
      </div>
    </Dialog>;
  }

  const saveApiKeys = () => {
    saveApiKeyPreferences(apiKeys);
    finish();
  };

  if (step === 'welcome') {
    return <Dialog isOpen title="Welcome to Triplo" onClose={onComplete} className="setup-dialog">
      <p>Triplo is a multi-modal route planner and trip logger application. Triplo is serverless which means that data is stored in your browser and in third-party cloud storages. By continuing, you accept these conditions.</p>
      <div className="setup-option-group">
        <strong>Set up Triplo for the first time</strong>
        <span>Choose a storage service:</span>
        <div>
          <button className="dialog-btn dialog-btn-cancel" onClick={() => { setMode('new'); chooseGoogle('new'); }}><img src={googleDriveService.icon} alt="Google Drive" width="18" height="18" /> <span>Google Drive</span></button>
          <button className="dialog-btn dialog-btn-cancel" onClick={() => { setMode('new'); setStep('github'); }}><img src={githubService.icon} alt="GitHub" width="18" height="18" /> <span>GitHub</span></button>
        </div>
      </div>
      <div className="setup-option-group">
        <strong>Fetch existing Triplo setup</strong>
        <div>
          <button className="dialog-btn dialog-btn-cancel" onClick={() => { setMode('restore'); chooseGoogle('restore'); }}><img src={googleDriveService.icon} alt="Google Drive" width="18" height="18" /> <span>Google Drive</span></button>
          <button className="dialog-btn dialog-btn-cancel" onClick={() => { setMode('restore'); setStep('github'); }}><img src={githubService.icon} alt="GitHub" width="18" height="18" /> <span>GitHub</span></button>
        </div>
      </div>
      <div className="setup-option-group">
        <strong>Explore Triplo without setup</strong>
        <small style={{ color: 'rgb(122, 82, 0)' }}>Info: Your data will only be stored in your browser with this option and may be lost anytime. Use this option only to get familiar with Triplo.</small>
        <button className="dialog-btn dialog-btn-cancel" onClick={onComplete}>Explore Triplo</button>
      </div>
    </Dialog>;
  }

  if (step === 'google-folder') {
    return <Dialog isOpen title="Google Drive Configuration" onClose={onComplete} className="setup-dialog" actions={<><button className="dialog-btn dialog-btn-cancel" onClick={() => setStep('welcome')}>Back</button> <button className="dialog-btn dialog-btn-primary" onClick={() => { localStorage.setItem('gdrive_folder_name', folderName.trim() || 'Triplo Trips'); continueAfterStorage(); }}>Continue</button></>}>
      <div className="setup-folder-input"><span>My Drive /</span><input value={folderName} onChange={event => setFolderName(event.target.value)} placeholder="Triplo Trips" /></div>
    </Dialog>;
  }

  if (step === 'github') {
    return <Dialog isOpen title="GitHub Configuration" onClose={onComplete} className="setup-dialog" actions={<><button className="dialog-btn dialog-btn-cancel" onClick={() => setStep('welcome')}>Back</button> <button className="dialog-btn dialog-btn-primary" disabled={!repo.trim() || !token.trim()} onClick={saveGitHub}>Continue</button></>}>
      {mode === 'new' && <p><a href="https://github.com/new" target="_blank" rel="noreferrer">Create a repository</a> for your Triplo trips.</p>}
      <label className="setup-field">Repository name<input value={repo} onChange={event => setRepo(event.target.value)} placeholder="username/repository" /></label>
      <label className="setup-field">Personal Access Token<input type="password" value={token} onChange={event => setToken(event.target.value)} placeholder="Personal Access Token" /></label>
      {mode === 'new' && 
        <div>
          <p><strong>Tip:</strong> you may want to save these credentials to your password manager.</p>
          <p>We strongly suggest using a fine-grained PAT with access limited to this single repository:</p>
          <ol><li>Go to <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">GitHub fine-grained token settings</a>.</li><li>Choose the “Only select repositories” repository access option with your Triplo repository.</li><li>Add the “Contents” permission with read and write access.</li></ol>
        </div>
      }
    </Dialog>;
  }

  const mapyTester = routingManager.getServices().find(service => service.getApiKeyConfiguration?.()?.preferenceKey === 'mapyApiKey')?.testApiKey;
  const graphHopperTester = routingManager.getServices().find(service => service.getApiKeyConfiguration?.()?.preferenceKey === 'graphHopperApiKey')?.testApiKey;
  return <Dialog isOpen title="API Keys" onClose={onComplete} className="setup-dialog api-key-dialog" actions={<button className="dialog-btn dialog-btn-primary" onClick={saveApiKeys}>Finish</button>}>
    <p>Triplo applies a bring-your-own-key policy for routing and map tile services that need an API key: you need to create and set your own key to use these services. We strongly suggest setting these keys, otherwise, most routing services will not be available. The free tiers of these services should provide you ample credits to use Triplo assuming average usage.</p>
    <ApiKeyConfigurationSection configuration={MAPY_API_CONFIGURATION} apiKey={apiKeys.mapyApiKey} onApiKeyChange={mapyApiKey => setApiKeys(previous => ({ ...previous, mapyApiKey }))} testApiKey={mapyTester?.bind(routingManager.getServices().find(service => service.getApiKeyConfiguration?.()?.preferenceKey === 'mapyApiKey'))} />
    <hr className="setup-divider" />
    <ApiKeyConfigurationSection configuration={GRAPHHOPPER_API_CONFIGURATION} apiKey={apiKeys.graphHopperApiKey} onApiKeyChange={graphHopperApiKey => setApiKeys(previous => ({ ...previous, graphHopperApiKey }))} testApiKey={graphHopperTester?.bind(routingManager.getServices().find(service => service.getApiKeyConfiguration?.()?.preferenceKey === 'graphHopperApiKey'))} />
    <p style={{ color: 'rgb(122, 82, 0)' }}><strong>Info:</strong> your API key is saved to your selected cloud storage as plain text. Only use trusted cloud storage.</p>
  </Dialog>;
}
