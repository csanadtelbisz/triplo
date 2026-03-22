export const getPOIEmoji = (cls?: string, sub?: string): string => {
  const emojiMap: Record<string, string> = {
    peak: '⛰️',
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
    bus_stop: '🚌',
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
    saddle: '⛰️'
  };

  return (sub && emojiMap[sub]) || (cls && emojiMap[cls]) || '📍';
};