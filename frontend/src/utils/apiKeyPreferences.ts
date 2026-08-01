export interface ApiKeyPreferences {
  mapyApiKey: string;
  graphHopperApiKey: string;
}

export interface ApiKeyServiceConfiguration {
  serviceName: 'Mapy' | 'Graphhopper';
  preferenceKey: keyof ApiKeyPreferences;
  inputLabel: string;
  instructions: string[];
}

const STORAGE_KEY = 'apiKeyPreferences';

export const MAPY_API_CONFIGURATION: ApiKeyServiceConfiguration = {
  serviceName: 'Mapy',
  preferenceKey: 'mapyApiKey',
  inputLabel: 'Mapy API key',
  instructions: [
    'Go to https://developer.mapy.com/account/projects',
    'Log in or register.',
    'Create a new project.',
    'Copy your API key from the project dashboard.',
  ],
};

export const GRAPHHOPPER_API_CONFIGURATION: ApiKeyServiceConfiguration = {
  serviceName: 'Graphhopper',
  preferenceKey: 'graphHopperApiKey',
  inputLabel: 'Graphhopper API key',
  instructions: [
    'Go to https://graphhopper.com/dashboard/api-keys',
    'Sign in or create a new account.',
    'Create a new key and copy it.',
  ],
};

const defaults = (): ApiKeyPreferences => ({
  mapyApiKey: import.meta.env.VITE_MAPY_API_KEY || '',
  graphHopperApiKey: import.meta.env.VITE_GRAPHHOPPER_API_KEY || '',
});

export function getApiKeyPreferences(): ApiKeyPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults();
    const values = JSON.parse(stored) as Partial<ApiKeyPreferences>;
    return {
      mapyApiKey: typeof values.mapyApiKey === 'string' ? values.mapyApiKey : defaults().mapyApiKey,
      graphHopperApiKey: typeof values.graphHopperApiKey === 'string' ? values.graphHopperApiKey : defaults().graphHopperApiKey,
    };
  } catch {
    return defaults();
  }
}

export function saveApiKeyPreferences(preferences: ApiKeyPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function getApiKey(preferenceKey: keyof ApiKeyPreferences): string {
  return getApiKeyPreferences()[preferenceKey];
}
