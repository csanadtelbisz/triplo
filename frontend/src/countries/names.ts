import { englishCountryNames } from './englishNames';
import type { CountryEntry } from './types';

export function countryName(country: Pick<CountryEntry, 'code' | 'name'>): string {
  const translated = englishCountryNames[country.code];
  return translated?.primary === country.name ? translated.english : country.name;
}
