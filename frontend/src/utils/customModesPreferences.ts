import type { TransportMode } from "../../../shared/types";
import { getModeColor } from "./builtInModesPreferences";

export interface CustomOtherMode {
  icon: string;
  name: string;
  color: string;
  routingProfile: string;
  showInList?: boolean;
}

export const getCustomOtherModes = (): CustomOtherMode[] => {
  try {
    const data = localStorage.getItem("customOtherModes");
    if (!data) return [];
    const parsed = JSON.parse(data);
    return Array.isArray(parsed)
      ? parsed.map((m: Partial<CustomOtherMode>) => ({
          icon: m.icon || '',
          name: m.name || '',
          color: m.color || '#000000',
          routingProfile: m.routingProfile || 'Straight Line Router|straight_line',
          showInList: m.showInList !== undefined ? m.showInList : true,
        }))
      : [];
  } catch {
    return [];
  }
};

export const saveCustomOtherModes = (modes: CustomOtherMode[]) => {
  localStorage.setItem("customOtherModes", JSON.stringify(modes));
};

export const getModeAndIconColor = (mode: TransportMode, icon: string): string => {
  if (mode !== 'other') return getModeColor(mode);
  const customModes = getCustomOtherModes();
  const customMode = customModes.find(m => m.icon === icon);
  return customMode ? customMode.color : getModeColor(mode);
}

