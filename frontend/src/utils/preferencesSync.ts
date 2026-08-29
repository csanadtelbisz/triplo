import { persistingManager } from '../persisting/PersistingManager';
import { getLanguagePreferences, saveLanguagePreferences } from './languagePreferences';
import { getCustomOtherModes, saveCustomOtherModes } from './customModesPreferences';
import { getBuiltInModeOverrides, saveBuiltInModeOverrides } from './builtInModesPreferences';
import { getActiveStyleConfigId, getStyleConfigs, saveStyleConfigs } from './mapStylesPreferences';
import { getTripListPreferences, saveTripListPreferences } from './tripListPreferences';
import { getApiKeyPreferences, saveApiKeyPreferences } from './apiKeyPreferences';
import type { RenderStyleConfig } from './mapStylesPreferences';

let syncTimeout: any;
let preferencesSyncStatus: 'idle' | 'pending' | 'syncing' | 'synced' | 'error' | 'unavailable' = 'idle';
let preferencesDirty = false;
let pendingStyleConfigScriptIds = new Set<string>();

const setPreferencesSyncStatus = (status: typeof preferencesSyncStatus, dirty = preferencesDirty) => {
  preferencesSyncStatus = status;
  preferencesDirty = dirty;
  window.dispatchEvent(new Event('preferences-sync-status'));
};

export const getPreferencesSyncStatus = () => preferencesSyncStatus;
export const hasUnsyncedPreferences = () => preferencesDirty;

interface SyncedStyleConfigMetadata {
  id: string;
  name: string;
  fileName: string;
  order: number;
  readonly?: boolean;
  updatedAt?: string;
}

interface SyncedStyleConfigurations {
  version: 1;
  stylesDirectory: 'styles';
  activeId: string;
  configs: SyncedStyleConfigMetadata[];
}

function toSafeStyleFileName(config: RenderStyleConfig) {
  const safeName = config.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'style';
  const safeId = config.id.replace(/[^a-zA-Z0-9-]/g, '') || crypto.randomUUID();
  return `${safeName}_${safeId}.js`;
}

function getSyncedStyleConfigs(): SyncedStyleConfigurations {
  const configs = getStyleConfigs()
    .filter(config => config.id !== 'default')
    .map((config, index) => ({
      id: config.id,
      name: config.name,
      fileName: toSafeStyleFileName(config),
      order: index,
      readonly: config.readonly,
      // Legacy configurations predate per-style timestamps. Give them a stable
      // old value so they can participate in conflict detection without being
      // treated as newly edited on every sync.
      updatedAt: config.updatedAt || new Date(0).toISOString()
    }));

  return {
    version: 1,
    stylesDirectory: 'styles',
    activeId: getActiveStyleConfigId(),
    configs
  };
}

function getStyleScriptPath(fileName: string) {
  return `styles/${fileName}`;
}

async function saveStyleConfigScripts(
  styleConfigurations: SyncedStyleConfigurations,
  styleConfigIds: ReadonlySet<string>
) {
  const configs = getStyleConfigs().filter(config => config.id !== 'default');
  for (const config of configs) {
    if (!styleConfigIds.has(config.id)) continue;
    const metadata = styleConfigurations.configs.find(item => item.id === config.id);
    if (!metadata) continue;
    try {
      await persistingManager.savePreferenceFile(getStyleScriptPath(metadata.fileName), config.script);
    } catch (e) {
      console.error(`Failed to sync style configuration script ${config.name}:`, e);
    }
  }
}

async function deleteRemovedStyleConfigScripts(previousStyleConfigurations: SyncedStyleConfigurations | undefined, currentStyleConfigurations: SyncedStyleConfigurations) {
  if (!previousStyleConfigurations?.configs || !Array.isArray(previousStyleConfigurations.configs)) return;

  const currentFileNamesById = new Map(currentStyleConfigurations.configs.map(config => [config.id, config.fileName]));
  for (const previousConfig of previousStyleConfigurations.configs) {
    const currentFileName = currentFileNamesById.get(previousConfig.id);
    if (currentFileName === previousConfig.fileName) continue;

    try {
      await persistingManager.deletePreferenceFile(getStyleScriptPath(previousConfig.fileName));
    } catch (e) {
      console.error(`Failed to delete removed style configuration script ${previousConfig.fileName}:`, e);
    }
  }
}

async function loadStyleConfigScripts(styleConfigurations: SyncedStyleConfigurations, source?: string): Promise<RenderStyleConfig[]> {
  const orderedMetadata = [...styleConfigurations.configs].sort((a, b) => a.order - b.order);
  const loaded = await Promise.all(orderedMetadata.map(async (metadata): Promise<RenderStyleConfig | null> => {
    const path = getStyleScriptPath(metadata.fileName);
    const script = source
      ? await persistingManager.loadPreferenceFileFromService(source, path)
      : await persistingManager.loadPreferenceFile(path);
    if (script === null) {
      console.warn(`Style configuration script missing from synced preferences: styles/${metadata.fileName}`);
      return null;
    }
    const config: RenderStyleConfig = {
      id: metadata.id,
      name: metadata.name,
      script
    };
    if (metadata.readonly !== undefined) {
      config.readonly = metadata.readonly;
    }
    if (metadata.updatedAt !== undefined) {
      config.updatedAt = metadata.updatedAt;
    }
    return config;
  }));

  return loaded.filter((config): config is RenderStyleConfig => config !== null);
}

export const syncPreferencesToCloud = async (immediate = false, changedStyleConfigId?: string, forceAllStyleScripts = false) => {
  if (changedStyleConfigId) {
    pendingStyleConfigScriptIds.add(changedStyleConfigId);
  }

  const doSync = async () => {
    if (persistingManager.getAvailableServices().length === 0) {
      setPreferencesSyncStatus('unavailable', true);
      return;
    }
    setPreferencesSyncStatus('syncing', true);
    let styleConfigIdsToSave: Set<string> | undefined;
    try {
      const previousPrefs = await persistingManager.loadPreferences();
      const styleConfigurations = getSyncedStyleConfigs();
      styleConfigIdsToSave = pendingStyleConfigScriptIds;
      pendingStyleConfigScriptIds = new Set<string>();
      if (forceAllStyleScripts || !previousPrefs?.styleConfigurations?.configs) {
        for (const config of styleConfigurations.configs) {
          styleConfigIdsToSave.add(config.id);
        }
      }
      await saveStyleConfigScripts(styleConfigurations, styleConfigIdsToSave);
      await deleteRemovedStyleConfigScripts(previousPrefs?.styleConfigurations, styleConfigurations);

      const prefs = {
        language: getLanguagePreferences(),
        customModes: getCustomOtherModes(),
        builtInModes: getBuiltInModeOverrides(),
        homePosition: localStorage.getItem('homeMapPosition') ? JSON.parse(localStorage.getItem('homeMapPosition')!) : null,
        tripList: getTripListPreferences(),
        apiKeys: getApiKeyPreferences(),
        styleConfigurations
      };
      const previousComparable = previousPrefs ? { ...previousPrefs } : null;
      if (previousComparable) delete previousComparable.updatedAt;
      const nextComparable = { ...prefs };
      const hasChanged = JSON.stringify(nextComparable) !== JSON.stringify(previousComparable);
      await persistingManager.savePreferences({
        ...prefs,
        updatedAt: hasChanged || !previousPrefs?.updatedAt ? new Date().toISOString() : previousPrefs.updatedAt
      });
      setPreferencesSyncStatus('synced', false);
    } catch (e) {
      for (const configId of styleConfigIdsToSave || []) {
        pendingStyleConfigScriptIds.add(configId);
      }
      console.error('Failed to sync preferences to cloud:', e);
      setPreferencesSyncStatus('error', true);
    }
  };

  if (immediate) {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = undefined;
    }
    await doSync();
  } else {
    setPreferencesSyncStatus('pending', true);
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
    syncTimeout = setTimeout(() => {
      doSync();
    }, 1500);
  }
};

export const loadPreferencesFromCloud = async (preferences?: any, source?: string): Promise<boolean> => {
  try {
    const prefs = preferences || await persistingManager.loadPreferences();
    if (prefs) {
      let changed = false;
      
      const prevLang = JSON.stringify(getLanguagePreferences());
      if (prefs.language && JSON.stringify(prefs.language) !== prevLang) {
        saveLanguagePreferences(prefs.language);
        changed = true;
      }
      
      const prevModes = JSON.stringify(getCustomOtherModes());
      if (prefs.customModes && JSON.stringify(prefs.customModes) !== prevModes) {
        saveCustomOtherModes(prefs.customModes);
        changed = true;
      }

      const prevBuiltIn = JSON.stringify(getBuiltInModeOverrides());
      if (prefs.builtInModes && JSON.stringify(prefs.builtInModes) !== prevBuiltIn) {
        saveBuiltInModeOverrides(prefs.builtInModes);
        changed = true;
      }

      const prevHome = localStorage.getItem('homeMapPosition');
      if (prefs.homePosition && JSON.stringify(prefs.homePosition) !== prevHome) {
        localStorage.setItem('homeMapPosition', JSON.stringify(prefs.homePosition));
        changed = true;
      }

      if (prefs.tripList) {
        const previousTripList = JSON.stringify(getTripListPreferences());
        const nextTripList = JSON.stringify(prefs.tripList);
        if (nextTripList !== previousTripList) {
          saveTripListPreferences(prefs.tripList);
          changed = true;
        }
      }

      if (prefs.apiKeys) {
        const previousApiKeys = JSON.stringify(getApiKeyPreferences());
        const nextApiKeys = JSON.stringify(prefs.apiKeys);
        if (nextApiKeys !== previousApiKeys) {
          saveApiKeyPreferences(prefs.apiKeys);
          changed = true;
        }
      }

      if (prefs.styleConfigurations?.configs && Array.isArray(prefs.styleConfigurations.configs)) {
        const loadedStyleConfigs = await loadStyleConfigScripts(prefs.styleConfigurations, source);
        const prevStyleConfigs = JSON.stringify(getStyleConfigs().filter(c => c.id !== 'default'));
        if (JSON.stringify(loadedStyleConfigs) !== prevStyleConfigs) {
          saveStyleConfigs(loadedStyleConfigs);
          changed = true;
        }
      }

      if (changed) {
        window.dispatchEvent(new Event('preferences-updated'));
      }
      return changed;
    }
  } catch (e) {
    console.error('Failed to load preferences from cloud:', e);
  }
  return false;
};
