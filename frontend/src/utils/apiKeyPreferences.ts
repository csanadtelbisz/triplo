export interface ApiKeyPreferences {
  mapyApiKey: string;
  graphHopperApiKey: string;
  googleMapsApiKey: string;
}

export interface ApiKeyServiceConfiguration {
  serviceName: 'Mapy' | 'Graphhopper' | 'Google Maps';
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

export const GOOGLE_MAPS_API_CONFIGURATION: ApiKeyServiceConfiguration = {
  serviceName: 'Google Maps',
  preferenceKey: 'googleMapsApiKey',
  inputLabel: 'Google Maps API key',
  instructions: [
    'Go to https://console.cloud.google.com/google/maps-apis/credentials',
    'Select or create a Google Cloud project and enable billing for it.',
    'Enable the Routes API in the project.',
    'Create an API key, then restrict it to the Routes API and to your website HTTP referrers.',
    'Copy the API key here. Google may charge for Routes API usage according to your project pricing and quotas.',
  ],
};

const defaults = (): ApiKeyPreferences => ({
  mapyApiKey: import.meta.env.VITE_MAPY_API_KEY || '',
  graphHopperApiKey: import.meta.env.VITE_GRAPHHOPPER_API_KEY || '',
  googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
});

export function getApiKeyPreferences(): ApiKeyPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults();
    const values = JSON.parse(stored) as Partial<ApiKeyPreferences>;
    return {
      mapyApiKey: typeof values.mapyApiKey === 'string' ? values.mapyApiKey : defaults().mapyApiKey,
      graphHopperApiKey: typeof values.graphHopperApiKey === 'string' ? values.graphHopperApiKey : defaults().graphHopperApiKey,
      googleMapsApiKey: typeof values.googleMapsApiKey === 'string' ? values.googleMapsApiKey : defaults().googleMapsApiKey,
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
