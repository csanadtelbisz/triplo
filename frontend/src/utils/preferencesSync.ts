import { persistingManager } from '../persisting/PersistingManager';
import { getLanguagePreferences, saveLanguagePreferences } from './languagePreferences';
import { getCustomOtherModes, saveCustomOtherModes, getShowCustomModesInDefault, setShowCustomModesInDefault } from './customModesPreferences';

export const syncPreferencesToCloud = async () => {
  try {
    const prefs = {
      language: getLanguagePreferences(),
      customModes: getCustomOtherModes(),
      showCustomModesInDefault: getShowCustomModesInDefault(),
      homePosition: localStorage.getItem('homeMapPosition') ? JSON.parse(localStorage.getItem('homeMapPosition')!) : null
    };
    await persistingManager.savePreferences(prefs);
  } catch (e) {
    console.error('Failed to sync preferences to cloud:', e);
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

      if (prefs.showCustomModesInDefault !== undefined && prefs.showCustomModesInDefault !== getShowCustomModesInDefault()) {
        setShowCustomModesInDefault(prefs.showCustomModesInDefault);
        changed = true;
      }

      const prevHome = localStorage.getItem('homeMapPosition');
      if (prefs.homePosition && JSON.stringify(prefs.homePosition) !== prevHome) {
        localStorage.setItem('homeMapPosition', JSON.stringify(prefs.homePosition));
        changed = true;
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