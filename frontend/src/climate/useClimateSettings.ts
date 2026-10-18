import { useEffect, useState } from 'react';
import { getClimateSettings } from './profiles';

export function useClimateSettings() {
  const [settings, setSettings] = useState(getClimateSettings);
  useEffect(() => {
    const update = () => setSettings(getClimateSettings());
    window.addEventListener('preferences-updated', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('preferences-updated', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return settings;
}
