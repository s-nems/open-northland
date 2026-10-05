import { messages } from '../../i18n/index.js';
import type { GameSettingsRuntime } from '../../view/runtime/game-settings.js';
import { createSettingsPage, initialSettingsMemory } from '../../view/settings-page.js';
import { GLYPH } from './icons.js';
import { createHudWindow } from './window.js';

export function createSystemSettings(opts: {
  readonly plane: HTMLElement;
  readonly settings: GameSettingsRuntime;
  readonly signal: AbortSignal;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly confirmRestore: () => Promise<boolean>;
}) {
  const copy = messages();
  const frame = createHudWindow(opts.plane, {
    title: copy.mainMenu.screenTitles.settings,
    subtitle: copy.hud.systemMenuDetails.settingsHint,
    closeLabel: copy.hud.systemMenuDetails.resume,
    width: 860,
  });
  frame.element.classList.add('on-system-dialog', 'on-system-settings');
  frame.element.setAttribute('role', 'dialog');
  frame.element.setAttribute('aria-modal', 'true');
  frame.onDismiss(opts.onClose);
  const memory = initialSettingsMemory();
  const page = createSettingsPage({
    settings: opts.settings,
    memory,
    signal: opts.signal,
    visible: frame.isOpen,
    hud: true,
    confirmRestore: opts.confirmRestore,
  });
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'on-button on-settings__back';
  back.innerHTML = GLYPH.back;
  const label = document.createElement('span');
  label.textContent = copy.hud.systemMenuDetails.back;
  back.append(label);
  back.addEventListener('click', opts.onBack);
  frame.body.append(page.el, back);
  return {
    el: frame.element,
    open(): void {
      page.render();
      frame.open();
      page.el.querySelector<HTMLElement>('.is-active')?.focus();
    },
    refresh(): void {
      if (frame.isOpen() && memory.tab === 'graphics') page.render();
    },
    close(): void {
      page.suspend();
      frame.close();
    },
  };
}
