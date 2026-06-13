import { persistingManager } from '../persisting/PersistingManager';
import { getLanguagePreferences, saveLanguagePreferences } from './languagePreferences';
import { getCustomOtherModes, saveCustomOtherModes, getShowCustomModesInDefault, setShowCustomModesInDefault } from './customModesPreferences';
import { getBuiltInModeOverrides, saveBuiltInModeOverrides } from './builtInModesPreferences';
import { getActiveStyleConfigId, getStyleConfigs, saveStyleConfigs, setActiveStyleConfigId } from './mapStylesPreferences';
import type { RenderStyleConfig } from './mapStylesPreferences';

let syncTimeout: any;

interface SyncedStyleConfigMetadata {
  id: string;
  name: string;
  fileName: string;
  order: number;
  readonly?: boolean;
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
      readonly: config.readonly
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

async function saveStyleConfigScripts(styleConfigurations: SyncedStyleConfigurations) {
  const configs = getStyleConfigs().filter(config => config.id !== 'default');
  for (const config of configs) {
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

async function loadStyleConfigScripts(styleConfigurations: SyncedStyleConfigurations): Promise<RenderStyleConfig[]> {
  const orderedMetadata = [...styleConfigurations.configs].sort((a, b) => a.order - b.order);
  const loaded = await Promise.all(orderedMetadata.map(async (metadata): Promise<RenderStyleConfig | null> => {
    const script = await persistingManager.loadPreferenceFile(getStyleScriptPath(metadata.fileName));
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
    return config;
  }));

  return loaded.filter((config): config is RenderStyleConfig => config !== null);
}

export const syncPreferencesToCloud = async (immediate = false) => {
  const doSync = async () => {
    try {
      const previousPrefs = await persistingManager.loadPreferences();
      const styleConfigurations = getSyncedStyleConfigs();
      await saveStyleConfigScripts(styleConfigurations);
      await deleteRemovedStyleConfigScripts(previousPrefs?.styleConfigurations, styleConfigurations);

      const prefs = {
        language: getLanguagePreferences(),
        customModes: getCustomOtherModes(),
        showCustomModesInDefault: getShowCustomModesInDefault(),
        builtInModes: getBuiltInModeOverrides(),
        homePosition: localStorage.getItem('homeMapPosition') ? JSON.parse(localStorage.getItem('homeMapPosition')!) : null,
        styleConfigurations
      };
      await persistingManager.savePreferences(prefs);
    } catch (e) {
      console.error('Failed to sync preferences to cloud:', e);
    }
  };

  if (immediate) {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      syncTimeout = undefined;
    }
    await doSync();
  } else {
    if (syncTimeout) {
      clearTimeout(syncTimeout);
    }
    syncTimeout = setTimeout(() => {
      doSync();
    }, 1500);
  }
};

export const loadPreferencesFromCloud = async (): Promise<boolean> => {
  try {
    const prefs = await persistingManager.loadPreferences();
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

      if (prefs.showCustomModesInDefault !== undefined && prefs.showCustomModesInDefault !== getShowCustomModesInDefault()) {
        setShowCustomModesInDefault(prefs.showCustomModesInDefault);
        changed = true;
      }

      const prevHome = localStorage.getItem('homeMapPosition');
      if (prefs.homePosition && JSON.stringify(prefs.homePosition) !== prevHome) {
        localStorage.setItem('homeMapPosition', JSON.stringify(prefs.homePosition));
        changed = true;
      }

      if (prefs.styleConfigurations?.configs && Array.isArray(prefs.styleConfigurations.configs)) {
        const loadedStyleConfigs = await loadStyleConfigScripts(prefs.styleConfigurations);
        const prevStyleConfigs = JSON.stringify(getStyleConfigs().filter(c => c.id !== 'default'));
        if (JSON.stringify(loadedStyleConfigs) !== prevStyleConfigs) {
          saveStyleConfigs(loadedStyleConfigs);
          changed = true;
        }

        if (prefs.styleConfigurations.activeId && prefs.styleConfigurations.activeId !== getActiveStyleConfigId()) {
          setActiveStyleConfigId(prefs.styleConfigurations.activeId);
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
