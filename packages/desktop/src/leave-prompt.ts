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

const LOCALE_CODES = ['pol', 'eng', 'ger', 'rus'] as const;
type LocaleCode = (typeof LOCALE_CODES)[number];

/** The app's `?lang=` spellings: its own code or the language tag. */
const LOCALE_TAGS: Readonly<Record<LocaleCode, string>> = { pol: 'pl', eng: 'en', ger: 'de', rus: 'ru' };

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
};

function localeOf(value: string | null | undefined): LocaleCode | undefined {
  const wanted = value?.toLowerCase();
  if (wanted === undefined) return undefined;
  return LOCALE_CODES.find((code) => code === wanted || LOCALE_TAGS[code] === wanted);
}

/** The page's `?lang=` wins, as it does in the app; the system language stands in when it has none. */
export function leavePromptFor(pageUrl: string, systemLocale: string): LeavePrompt {
  let lang: string | null = null;
  try {
    lang = new URL(pageUrl).searchParams.get('lang');
  } catch {
    // A page that has not loaded yet has no address worth reading.
  }
  const locale = localeOf(lang) ?? localeOf(systemLocale.split('-')[0]) ?? FALLBACK;
  return PROMPTS[locale];
}
