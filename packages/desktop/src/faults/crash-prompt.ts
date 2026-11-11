import { type LocaleCode, shellLocaleFor } from '../window/leave-prompt.js';

/** The native dialog shown instead of a second automatic reload when the page keeps crashing. */
export interface CrashPrompt {
  readonly title: string;
  readonly message: string;
  readonly restart: string;
  readonly quit: string;
}

const TITLE = 'Open Northland';

const PROMPTS: Readonly<Record<LocaleCode, CrashPrompt>> = {
  pol: {
    title: TITLE,
    message: 'Gra znowu przestała działać zaraz po ponownym uruchomieniu.',
    restart: 'Uruchom ponownie',
    quit: 'Zamknij grę',
  },
  eng: {
    title: TITLE,
    message: 'The game stopped working again right after restarting.',
    restart: 'Restart',
    quit: 'Quit',
  },
  ger: {
    title: TITLE,
    message: 'Das Spiel ist kurz nach dem Neustart erneut abgestürzt.',
    restart: 'Neu starten',
    quit: 'Beenden',
  },
  rus: {
    title: TITLE,
    message: 'Игра снова перестала работать сразу после перезапуска.',
    restart: 'Перезапустить',
    quit: 'Выйти',
  },
  ita: {
    title: TITLE,
    message: 'Il gioco ha smesso di nuovo di funzionare subito dopo il riavvio.',
    restart: 'Riavvia',
    quit: 'Esci',
  },
  chs: {
    title: TITLE,
    message: '游戏在重新启动后不久再次停止运行。',
    restart: '重新启动',
    quit: '退出',
  },
  cht: {
    title: TITLE,
    message: '遊戲在重新啟動後不久再次停止執行。',
    restart: '重新啟動',
    quit: '結束',
  },
};

export function crashPromptFor(pageUrl: string, systemLocale: string): CrashPrompt {
  return PROMPTS[shellLocaleFor(pageUrl, systemLocale)];
}
