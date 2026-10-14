import { messages } from '../i18n/index.js';
import { BUTTON_STYLE, DIALOG_STYLE, el } from '../view/overlay.js';

export function campaignFailureDialog(retry: () => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  const copy = messages().campaign;
  const dialog = el('dialog', `${DIALOG_STYLE};max-width:30rem`);
  dialog.append(el('p', 'line-height:1.5', copy.storage));
  const button = el('button', BUTTON_STYLE, copy.retry);
  const dispose = (): void => {
    dialog.remove();
    signal.removeEventListener('abort', dispose);
  };
  button.addEventListener('click', () => {
    dispose();
    retry();
  });
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.append(button);
  signal.addEventListener('abort', dispose, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  button.focus();
}
