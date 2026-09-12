import { messages } from '../../i18n/index.js';
import { BUTTON_STYLE, el } from '../overlay.js';

export function subMissionDialog(): { failed(retry: () => void, stay?: () => void): void; dispose(): void } {
  const copy = messages().subMission;
  const dialog = document.createElement('dialog');
  dialog.style.cssText =
    'max-width:30rem;padding:24px;background:#302719;color:#f4e6cb;border:1px solid #a18a5d';
  const text = el('p', 'line-height:1.5', copy.loading);
  dialog.append(text);
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  dialog.showModal();
  return {
    failed(retry, stay) {
      text.textContent = copy.failed;
      const button = el('button', BUTTON_STYLE, copy.retry);
      button.addEventListener('click', () => {
        dialog.remove();
        retry();
      });
      dialog.append(button);
      if (stay !== undefined) {
        const cancel = el('button', BUTTON_STYLE, copy.stay);
        cancel.addEventListener('click', () => {
          dialog.remove();
          stay();
        });
        dialog.append(cancel);
      }
      button.focus();
    },
    dispose: () => dialog.remove(),
  };
}
