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

