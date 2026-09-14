/**
 * One-shot file inputs. Both settle on `cancel` and, for a browser that does not fire it, once the
 * window has focus again and the input still holds nothing; without that second path a dismissed
 * dialog would leave the caller pending for the rest of the session.
 */

/** How long after the window regains focus a `change` event may still arrive. */
const DISMISS_GRACE_MS = 300;

function oneShotInput<T>(
  configure: (input: HTMLInputElement) => void,
  read: (input: HTMLInputElement) => T | null,
): Promise<T | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    configure(input);
    let settled = false;
    const settle = (value: T | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onRefocus);
      resolve(value);
    };
    const onRefocus = (): void => {
      window.setTimeout(() => settle(read(input)), DISMISS_GRACE_MS);
    };
    input.addEventListener('change', () => settle(read(input)));
    input.addEventListener('cancel', () => settle(null));
    window.addEventListener('focus', onRefocus);
    input.click();
  });
}

/** The "I already have it" affordance takes the mod zip itself: a browser page cannot adopt an
 *  unpacked folder the way the desktop shell does. */
export function pickZipFile(): Promise<File | null> {
  return oneShotInput(
    (input) => {
      input.accept = '.zip,application/zip';
    },
    (input) => input.files?.[0] ?? null,
  );
}
