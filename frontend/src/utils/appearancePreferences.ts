export type AppearanceTheme = 'system' | 'dark' | 'light';

export interface AppearancePreferences {
  theme: AppearanceTheme;
  forceLightMaps: boolean;
}

const THEME_KEY = 'appearanceTheme';
const FORCE_LIGHT_MAPS_KEY = 'forceLightMaps';

const isAppearanceTheme = (value: string | null): value is AppearanceTheme =>
  value === 'system' || value === 'dark' || value === 'light';

export const getAppearancePreferences = (): AppearancePreferences => {
  const storedTheme = localStorage.getItem(THEME_KEY);
  return {
    theme: isAppearanceTheme(storedTheme) ? storedTheme : 'system',
    forceLightMaps: localStorage.getItem(FORCE_LIGHT_MAPS_KEY) === 'true'
  };
};

export const saveAppearancePreferences = (preferences: AppearancePreferences) => {
  localStorage.setItem(THEME_KEY, preferences.theme);
  localStorage.setItem(FORCE_LIGHT_MAPS_KEY, String(preferences.forceLightMaps));
  window.dispatchEvent(new Event('preferences-updated'));
};

export const getResolvedAppearanceTheme = (theme = getAppearancePreferences().theme): 'dark' | 'light' => {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getMapTheme = (): 'dark' | 'light' => {
  const preferences = getAppearancePreferences();
  return preferences.forceLightMaps ? 'light' : getResolvedAppearanceTheme(preferences.theme);
};

export const applyAppearanceTheme = () => {
  document.body.classList.toggle('dark-mode', getResolvedAppearanceTheme() === 'dark');
};