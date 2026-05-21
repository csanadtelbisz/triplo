import type { TransportMode } from "../../../shared/types";
import { getModeColor } from "./builtInModesPreferences";

export interface CustomOtherMode {
  icon: string;
  name: string;
  color: string;
  routingProfile: string;
}

export const getCustomOtherModes = (): CustomOtherMode[] => {
  try {
    const data = localStorage.getItem("customOtherModes");
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

export const saveCustomOtherModes = (modes: CustomOtherMode[]) => {
  localStorage.setItem("customOtherModes", JSON.stringify(modes));
};

export const getShowCustomModesInDefault = (): boolean => {
  return localStorage.getItem("showCustomModesInDefault") === "true";
};

export const setShowCustomModesInDefault = (show: boolean) => {
  localStorage.setItem("showCustomModesInDefault", show ? "true" : "false");
};

export const getModeAndIconColor = (mode: TransportMode, icon: string): string => {
  if (mode !== 'other') return getModeColor(mode);
  const customModes = getCustomOtherModes();
  const customMode = customModes.find(m => m.icon === icon);
  return customMode ? customMode.color : getModeColor(mode);
}

