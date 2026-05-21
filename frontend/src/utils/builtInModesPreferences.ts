import type { TransportMode } from '../../../shared/types';
import { ModeThemes } from '../themes/config';

export interface BuiltInModeOverride {
  name?: string;
  color?: string;
  routingProfile?: string;
}

export type BuiltInModesOverrides = Partial<Record<TransportMode, BuiltInModeOverride>>;

export const BUILT_IN_MODES: TransportMode[] = [
  'walk', 'hike', 'run', 'bike', 'car', 'taxi', 'bus', 'rail', 'subway', 'flight', 'ferry'
];

export const BUILT_IN_ICONS: Record<string, string> = {
  walk: 'directions_walk',
  hike: 'hiking',
  run: 'directions_run',
  bike: 'pedal_bike',
  car: 'directions_car',
  taxi: 'local_taxi',
  bus: 'directions_bus',
  rail: 'train',
  subway: 'subway',
  flight: 'flight',
  ferry: 'directions_boat',
};

// Basic defaults, routing profile depends on what was in config or standard strings, usually "OSRM Router|car" etc. 
// We will just assume some standard strings, or leave them empty to signify 'system default'.
export const getBuiltInModeOverrides = (): BuiltInModesOverrides => {
  try {
    const data = localStorage.getItem("builtInModeOverrides");
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
};

export const saveBuiltInModeOverrides = (overrides: BuiltInModesOverrides) => {
  localStorage.setItem("builtInModeOverrides", JSON.stringify(overrides));
};

// Helper for UI to know colors
export const getDefaultColor = (mode: TransportMode) => {
  return ModeThemes[mode]?.color || '#95a5a6';
};

export const getModeColor = (mode: TransportMode) => {
  if (mode === 'other') return getDefaultColor(mode);
  const overrides = getBuiltInModeOverrides();
  return overrides[mode]?.color || getDefaultColor(mode);
};

export const getModeName = (mode: TransportMode) => {
  if (mode === 'other') return 'Other';
  const overrides = getBuiltInModeOverrides();
  return overrides[mode]?.name || mode.charAt(0).toUpperCase() + mode.slice(1);
};

export const getModeRoutingProfile = (mode: TransportMode, sysDefService: string, sysDefProfile: string): string => {
  if (mode === 'other') return `${sysDefService}|${sysDefProfile}`;
  const overrides = getBuiltInModeOverrides();
  return overrides[mode]?.routingProfile || `${sysDefService}|${sysDefProfile}`;
};

