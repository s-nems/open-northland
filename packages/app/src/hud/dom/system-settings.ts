import { messages } from '../../i18n/index.js';
import type { GameSettingsRuntime } from '../../view/runtime/game-settings.js';
import { createSettingsPage, initialSettingsMemory } from '../../view/settings-page.js';
import { createTooltip } from '../../view/tooltip.js';
import { GLYPH } from './icons.js';
import { attachTipLayer } from './parts/tip-layer.js';
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
    closeLabel: copy.hud.systemMenuDetails.resume,
    width: 720,
    compact: true,
  });
  frame.element.classList.add('on-system-dialog', 'on-system-settings');
  frame.element.style.removeProperty('width');
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
  const chip = createTooltip({ zIndex: 2001 });
  const tips = attachTipLayer(frame.element, chip);
  page.el.addEventListener('click', tips.hide, { signal: opts.signal });
  page.el.addEventListener('scroll', tips.hide, { capture: true, signal: opts.signal });
  opts.signal.addEventListener(
    'abort',
    () => {
      tips.dispose();
      chip.destroy();
    },
    { once: true },
  );
  return {
    el: frame.element,
    open(): void {
      tips.hide();
      page.render();
      frame.open();
      page.el.querySelector<HTMLElement>('.is-active')?.focus();
    },
    refresh(): void {
      if (frame.isOpen() && memory.tab === 'graphics') {
        tips.hide();
        page.render();
      }
    },
    close(): void {
      tips.hide();
      page.suspend();
      frame.close();
    },
  };
}
