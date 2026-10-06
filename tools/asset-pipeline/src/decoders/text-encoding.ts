/** Text folders use the language's Windows code page, independently of rule-file encoding. */
export function textEncoding(language: string): string {
  return language === 'rus' ? 'windows-1251' : language === 'ger' ? 'windows-1252' : 'windows-1250';
}
