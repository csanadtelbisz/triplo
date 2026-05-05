import { getLanguagePreferences } from './languagePreferences';

export const SUGGESTED_WAYPOINT_ICONS = [
  'landscape',
  'water',
  'beach_access',
  'location_city',
  'house',
  'hotel',
  'camping',
  'bus_railway',
  'flight_takeoff',
  'flight_land',
  'connecting_airports',
  'church',
  'mosque',
  'museum',
  'castle',
  'restaurant',
];

export const getPOIEmoji = (cls?: string, sub?: string, name?: string): string => {
  const emojiMap: Record<string, string> = {
    peak: '🔺',
    water: '💧',
    lake: '💧',
    campsite: '⛺',
    alpine_hut: '🛖',
    viewpoint: '🔭',
    historic: '🏛️',
    restaurant: '🍴',
    cafe: '☕',
    parking: '🅿️',
    information: 'ℹ️',
    shelter: '🛖',
    aerodrome: '✈️',
    bus_stop: '🚌',
    bus_station: '🚌',
    tram_stop: '🚊',
    subway: 'Ⓜ️',
    station: '🚉',
    bar: '🍻',
    supermarket: '🛒',
    bakery: '🥖',
    fast_food: '🍔',
    hospital: '🏥',
    pharmacy: '💊',
    police: '🚓',
    toilets: '🚻',
    waste_basket: '🗑️',
    bench: '🪑',
    atm: '🏧',
    bank: '🏦',
    post_office: '📮',
    school: '🏫',
    swimming_pool: '🏊',
    rock: '🪨',
    natural: '🍃',
    stone: '🪨',
    saddle: '⛰️',
    place_of_worship: '⛪',
    church: '⛪',
    mosque: '🕌',
    synagogue: '🕍',
    hindu_temple: '🛕',
    shinto: '⛩️',
    confucian: '🏯',
  };

  if ((cls === 'peak' || sub === 'peak') && (!name || name.trim() === '')) return emojiMap['rock'];
  return (sub && emojiMap[sub]) || (cls && emojiMap[cls]) || '📍';
};

export const resolvePOIName = (poi: any, details?: any): string => {
  if (!poi) return 'Point of Interest';
  const langPrefs = getLanguagePreferences();
  const rawDefault = poi.name || poi.name_int || details?.name;
  
  for (const lang of langPrefs) {
    const pName = poi[`name:${lang}`];
    if (pName) return pName;
  }
  
  return rawDefault || details?.display_name || 'Point of Interest';
};
