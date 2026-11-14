/**
 * The wording of the native dialog that stands in for the browser's leave prompt: the page asks to
 * stay through `beforeunload` while a game runs, and the shell has to ask the player itself.
 */
export interface LeavePrompt {
  readonly title: string;
  readonly message: string;
  readonly leave: string;
  readonly stay: string;
}

const LOCALE_CODES = ['pol', 'eng', 'ger', 'rus', 'ita', 'chs', 'cht'] as const;
/** The app's locale codes, which the shell's own native dialogs speak too. */
export type LocaleCode = (typeof LOCALE_CODES)[number];

/** The locale of each primary language subtag but Chinese, whose two locales split by script. */
const LOCALE_OF_LANGUAGE: ReadonlyMap<string, LocaleCode> = new Map([
  ['pl', 'pol'],
  ['en', 'eng'],
  ['de', 'ger'],
  ['ru', 'rus'],
  ['it', 'ita'],
]);

const CHINESE = 'zh';
/** A Chinese tag that names Traditional script, or no script and a region that writes it (CLDR likely
 *  subtags); every other Chinese tag reads Simplified, as in the app. */
const TRADITIONAL_CHINESE = /^zh-(?:hant|tw|hk|mo)(?:-|$)/;

const FALLBACK: LocaleCode = 'eng';

const PROMPTS: Readonly<Record<LocaleCode, LeavePrompt>> = {
  pol: {
    title: 'Open Northland',
    message: 'Zamknąć grę? Niezapisany postęp zostanie utracony.',
    leave: 'Zamknij',
    stay: 'Wróć do gry',
  },
  eng: {
    title: 'Open Northland',
    message: 'Close the game? Unsaved progress will be lost.',
    leave: 'Close',
    stay: 'Back to the game',
  },
  ger: {
    title: 'Open Northland',
    message: 'Spiel schließen? Nicht gespeicherter Fortschritt geht verloren.',
    leave: 'Schließen',
    stay: 'Zurück zum Spiel',
  },
  rus: {
    title: 'Open Northland',
    message: 'Закрыть игру? Несохранённый прогресс будет потерян.',
    leave: 'Закрыть',
    stay: 'Вернуться в игру',
  },
  ita: {
    title: 'Open Northland',
    message: 'Chiudere il gioco? I progressi non salvati andranno persi.',
    leave: 'Chiudi',
    stay: 'Torna al gioco',
  },
  chs: {
    title: 'Open Northland',
    message: '要关闭游戏吗？未保存的进度将会丢失。',
    leave: '关闭',
    stay: '返回游戏',
  },
  cht: {
    title: 'Open Northland',
    message: '要關閉遊戲嗎？未儲存的進度將會遺失。',
    leave: '關閉',
    stay: '返回遊戲',
  },
};

/** The app's `?lang=` spellings: its own code or a language tag. */
function localeOf(value: string | null | undefined): LocaleCode | undefined {
  const wanted = value?.toLowerCase().replaceAll('_', '-');
  if (wanted === undefined) return undefined;
  const code = LOCALE_CODES.find((locale) => locale === wanted);
  if (code !== undefined) return code;
  const language = wanted.split('-')[0] ?? '';
  if (language === CHINESE) return TRADITIONAL_CHINESE.test(wanted) ? 'cht' : 'chs';
  return LOCALE_OF_LANGUAGE.get(language);
}

/** The page's `?lang=` wins, as it does in the app; the system language stands in when it has none. */
export function shellLocaleFor(pageUrl: string, systemLocale: string): LocaleCode {
  let lang: string | null = null;
  try {
    lang = new URL(pageUrl).searchParams.get('lang');
  } catch {
    // A page that has not loaded yet has no address worth reading.
  }
  return localeOf(lang) ?? localeOf(systemLocale) ?? FALLBACK;
}

export function leavePromptFor(pageUrl: string, systemLocale: string): LeavePrompt {
  return PROMPTS[shellLocaleFor(pageUrl, systemLocale)];
}
