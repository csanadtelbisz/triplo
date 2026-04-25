export const OSM_LANGUAGES = [
  { code: 'ar', name: 'Arabic' },
  { code: 'ba', name: 'Bashkir' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'bo', name: 'Tibetan' },
  { code: 'ca', name: 'Catalan' },
  { code: 'cs', name: 'Czech' },
  { code: 'cu', name: 'Old Church Slavonic' },
  { code: 'cv', name: 'Chuvash' },
  { code: 'da', name: 'Danish' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gv', name: 'Manx' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hr', name: 'Croatian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'li', name: 'Limburgish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'no', name: 'Norwegian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'za', name: 'Zhuang' },
  { code: 'zh', name: 'Chinese' },
];

export const getLanguageName = (code: string): string => {
  const langInfo = OSM_LANGUAGES.find(l => l.code === code);
  if (langInfo) return langInfo.name;
  
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = displayNames.of(code);
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code;
  } catch (e) {
    return code; // Fallback to code if Intl fails (e.g. invalid tag)
  }
};

const PREF_KEY = 'triplo_language_preference';

export const getLanguagePreferences = (): string[] => {
  try {
    const stored = localStorage.getItem(PREF_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse language preferences', e);
  }
  return ['en']; // default
};

export const saveLanguagePreferences = (prefs: string[]) => {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
};
