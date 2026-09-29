/** Above the crash banner (2200): a crash from an outdated tab is explained by the update, not a bug. */
const UPDATE_BANNER_Z_INDEX = '2300';

const BANNER_STYLE = [
  'position:fixed',
  'top:12px',
  'left:50%',
  'transform:translateX(-50%)',
  'max-width:min(640px,90vw)',
  `z-index:${UPDATE_BANNER_Z_INDEX}`,
  'display:flex',
  'flex-wrap:wrap',
  'align-items:center',
  'gap:8px 14px',
  'padding:12px 16px',
  'background:rgba(16,34,44,0.96)',
  'color:#e8dcc0',
  'font:14px/1.4 ui-serif,Georgia,serif',
  'border:1px solid rgba(96,140,150,0.8)',
  'border-radius:8px',
  'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
].join(';');

const BUTTON_STYLE = [
  'padding:6px 12px',
  'background:rgba(40,70,80,0.9)',
  'color:#e8dcc0',
  'font:inherit',
  'border:1px solid rgba(96,140,150,0.7)',
  'border-radius:5px',
  'cursor:var(--cursor-pointer, pointer)',
].join(';');

export interface BannerAction {
  readonly label: string;
  readonly run: () => void;
}

let current: { readonly root: HTMLElement; readonly text: HTMLElement } | null = null;

/** Plain DOM, like the crash banner, so it shows whatever state the outdated code is in. */
export function showUpdateBanner(text: string, actions: readonly BannerAction[]): void {
  hideUpdateBanner();
  const root = document.createElement('div');
  root.style.cssText = BANNER_STYLE;
  root.setAttribute('role', 'status');
  const message = document.createElement('span');
  message.textContent = text;
  root.append(message);
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.style.cssText = BUTTON_STYLE;
    button.addEventListener('click', action.run);
    root.append(button);
  }
  document.body.append(root);
  current = { root, text: message };
}

export function setUpdateBannerText(text: string): void {
  if (current !== null) current.text.textContent = text;
}

export function hideUpdateBanner(): void {
  current?.root.remove();
  current = null;
}

export function updateBannerShown(): boolean {
  return current !== null;
}
