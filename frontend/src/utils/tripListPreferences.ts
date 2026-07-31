export type TripSortOrder = 'newer' | 'older' | 'name_asc' | 'name_desc';
export type TripListDisplayMode = 'compact' | 'detailed';

export interface TripListPreferences {
  sortOrder: TripSortOrder;
  displayMode: TripListDisplayMode;
}

const STORAGE_KEY = 'tripListPreferences';

const DEFAULT_PREFERENCES: TripListPreferences = {
  sortOrder: 'newer',
  displayMode: 'detailed',
};

export function getTripListPreferences(): TripListPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const value = JSON.parse(stored) as Partial<TripListPreferences>;
    return {
      sortOrder: ['newer', 'older', 'name_asc', 'name_desc'].includes(value.sortOrder || '')
        ? value.sortOrder as TripSortOrder
        : DEFAULT_PREFERENCES.sortOrder,
      displayMode: ['compact', 'detailed'].includes(value.displayMode || '')
        ? value.displayMode as TripListDisplayMode
        : DEFAULT_PREFERENCES.displayMode,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function saveTripListPreferences(preferences: TripListPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}
