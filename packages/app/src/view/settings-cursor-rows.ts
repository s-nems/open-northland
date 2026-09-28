import { messages } from '../i18n/index.js';
import { CURSOR_SIZES, CURSOR_THEMES, type CursorTheme } from './cursors/model.js';
import { cursorImage } from './cursors/theme.js';
import { segControl, settingRow, settingsHeading } from './settings-controls.js';
import type { SettingsPageStore } from './settings-page.js';

export function cursorSettingsRows(
  store: SettingsPageStore,
  markSegment: (root: HTMLElement, prefix: string) => void,
): HTMLElement[] {
  const text = messages().mainMenu.settings;
  const settings = store.current();
  const theme = segControl<CursorTheme>(
    CURSOR_THEMES.map((id) => ({ id, label: text.cursorThemes[id] })),
    settings.cursorTheme,
    (cursorTheme) => {
      void store.update({ cursorTheme });
      theme.setActive(cursorTheme);
    },
  );
  theme.root.classList.add('main-menu__cursor-themes');
  for (const [index, button] of [...theme.root.querySelectorAll('button')].entries()) {
    const id = CURSOR_THEMES[index];
    if (id === undefined) continue;
    if (id === 'system') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 28 28');
      icon.setAttribute('width', '28');
      icon.setAttribute('height', '28');
      icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M7 3v20l5-5 4 8 4-2-4-8h8Z');
      path.setAttribute('fill', 'currentColor');
      icon.append(path);
      button.prepend(icon);
      continue;
    }
    const image = document.createElement('img');
    image.src = cursorImage(id, 'normal', 28, 2);
    image.width = 28;
    image.height = 28;
    image.alt = '';
    button.prepend(image);
  }
  markSegment(theme.root, 'cursor-theme');
  const size = segControl<`${(typeof CURSOR_SIZES)[number]}`>(
    CURSOR_SIZES.map((value) => ({ id: `${value}`, label: `${value} px` })),
    `${settings.cursorSize}`,
    (choice) => {
      const cursorSize = CURSOR_SIZES.find((value) => `${value}` === choice);
      if (cursorSize === undefined) return;
      void store.update({ cursorSize });
      size.setActive(choice);
    },
  );
  markSegment(size.root, 'cursor-size');
  const themeRow = settingRow(text.cursorTheme, theme.root, { tip: text.cursorThemeTip });
  themeRow.classList.add('main-menu__settings-row--cursor-theme');
  return [
    settingsHeading(text.cursorHeading),
    themeRow,
    settingRow(text.cursorSize, size.root, { tip: text.cursorSizeTip }),
  ];
}
