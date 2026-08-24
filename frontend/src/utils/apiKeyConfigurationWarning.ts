import type { ApiKeyServiceConfiguration } from './apiKeyPreferences';

export const API_KEY_CONFIGURATION_WARNING_EVENT = 'api-key-configuration-required';
const warnedServices = new Set<string>();

export function showApiKeyConfigurationWarning(configuration: ApiKeyServiceConfiguration, forceWarning: boolean = false): void {
  if (!forceWarning) {
    if (warnedServices.has(configuration.preferenceKey)) return;
    warnedServices.add(configuration.preferenceKey);
  }

  window.dispatchEvent(new CustomEvent<ApiKeyServiceConfiguration>(API_KEY_CONFIGURATION_WARNING_EVENT, {
    detail: configuration
  }));
}
