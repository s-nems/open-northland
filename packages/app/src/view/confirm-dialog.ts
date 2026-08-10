/** Above the system menu's backdrop (z 2000), so the question always tops the panel that asked it. */
const DIALOG_Z_INDEX = '3000';

const BOX_STYLE = [
  'display:flex',
  'flex-direction:column',
  'gap:14px',
  'padding:20px',
  'max-width:min(420px,90vw)',
  'background:rgba(20,16,12,0.96)',
  'color:#e8dcc0',
  'font:15px/1.4 ui-serif,Georgia,serif',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:8px',
  'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
].join(';');

const BUTTON_STYLE = [
  'padding:8px 14px',
  'background:rgba(74,63,40,0.9)',
  'color:#e8dcc0',
  'font:inherit',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:5px',
  'cursor:pointer',
].join(';');

export interface ConfirmDialogCopy {
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Focused button, and so what Enter answers. Cancel unless the question stands between the
   *  player and the action they just asked for. */
  readonly defaultChoice?: 'confirm' | 'cancel';
}

/**
 * An in-page modal question resolving to the player's choice; Escape, backdrop click, and the
 * cancel button all decline. Replaces `window.confirm`, which would block the page's event loop.
 */
export function confirmDialog(copy: ConfirmDialogCopy): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    Object.assign(backdrop.style, {
      position: 'fixed',
      inset: '0',
      display: 'grid',
      placeItems: 'center',
      background: 'rgba(0,0,0,0.45)',
      zIndex: DIALOG_Z_INDEX,
    });

    const box = document.createElement('div');
    box.style.cssText = BOX_STYLE;
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', copy.message);

    const message = document.createElement('p');
    message.style.cssText = 'margin:0';
    message.textContent = copy.message;

    const prior = document.activeElement;
    const finish = (confirmed: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (prior instanceof HTMLElement) prior.focus();
      resolve(confirmed);
    };
    // Capture phase, so neither key reaches the panel or game bindings behind the dialog.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        finish(false);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        if (document.activeElement === cancel) confirm.focus();
        else cancel.focus();
      }
    };

    const button = (label: string, confirmed: boolean): HTMLButtonElement => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      el.style.cssText = BUTTON_STYLE;
      el.addEventListener('click', () => finish(confirmed));
      return el;
    };
    const cancel = button(copy.cancelLabel, false);
    const confirm = button(copy.confirmLabel, true);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    actions.append(cancel, confirm);

    box.append(message, actions);
    backdrop.append(box);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(backdrop);
    if (copy.defaultChoice === 'confirm') confirm.focus();
    else cancel.focus();
  });
}
