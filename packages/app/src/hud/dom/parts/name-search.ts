import { bcp47Tag } from '../../../i18n/index.js';

export const nameMatches = (label: string, query: string): boolean => {
  const normalize = (text: string): string =>
    text
      .trim()
      .toLocaleLowerCase(bcp47Tag())
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replaceAll('ł', 'l');
  return normalize(label).startsWith(normalize(query));
};
