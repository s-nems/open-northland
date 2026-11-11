/** The supported map corpus uses CP1250 in Latin slots, including Polish text stored under `ger`.
 * German umlauts and ß share those byte positions. The Russian slot uses CP1251. Italian text uses
 * CP1252, where CP1250 would read `à è ì ò ù` as `ŕ č ě ň ů`. */
export function mapTextEncoding(language: string): string {
  return language === 'rus' ? 'windows-1251' : language === 'ita' ? 'windows-1252' : 'windows-1250';
}

/** Authored plaintext may be UTF-8; accept it only when the entire file decodes without errors. */
export function decodeMapText(bytes: Uint8Array, language: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(mapTextEncoding(language)).decode(bytes);
  }
}
