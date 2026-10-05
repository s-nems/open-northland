import { createHudWindow } from './window.js';

/** A question above the current menu page. Cancelling restores that page and its focused control. */
export function createSystemConfirm(plane: HTMLElement) {
  let cancel: (() => void) | null = null;
  return {
    isOpen: (): boolean => cancel !== null,
    cancel: (): void => cancel?.(),
    open(copy: { title: string; message: string; cancel: string; confirm: string }): Promise<boolean> {
      cancel?.();
      const prior = document.activeElement;
      const shade = document.createElement('div');
      shade.className = 'on-system-confirm';
      const inert = new Map<HTMLElement, boolean>();
      for (const child of plane.children) {
        if (child instanceof HTMLElement) {
          inert.set(child, child.inert);
          child.inert = true;
        }
      }
      plane.append(shade);
      const frame = createHudWindow(shade, {
        title: copy.title,
        closeLabel: copy.cancel,
        width: 420,
        compact: true,
      });
      frame.element.classList.add('on-system-dialog');
      frame.element.setAttribute('role', 'alertdialog');
      frame.element.setAttribute('aria-modal', 'true');
      const message = document.createElement('p');
      message.className = 'on-system-confirm__message';
      message.textContent = copy.message;
      frame.body.append(message);
      return new Promise<boolean>((resolve) => {
        const finish = (result: boolean): void => {
          cancel = null;
          shade.remove();
          for (const [element, prior] of inert) element.inert = prior;
          if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
          resolve(result);
        };
        cancel = () => finish(false);
        frame.onDismiss(() => finish(false));
        shade.addEventListener('click', (event) => {
          if (event.target === shade) finish(false);
        });
        const actions = document.createElement('div');
        actions.className = 'on-system-confirm__actions';
        for (const [label, result] of [
          [copy.cancel, false],
          [copy.confirm, true],
        ] as const) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'on-button';
          button.textContent = label;
          button.addEventListener('click', () => finish(result));
          actions.append(button);
        }
        frame.body.append(actions);
        frame.open();
        actions.querySelector('button')?.focus();
      });
    },
  };
}
