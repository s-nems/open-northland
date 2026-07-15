import { messages } from '../i18n/index.js';

export interface SystemMenu {
  /** Show the menu if hidden, hide it if shown — the tool panel's `options` button drives this. */
  toggle(): void;
  /** Remove the overlay from the DOM (the owning game session's teardown). */
  dispose(): void;
}

export interface SystemMenuDeps {
  /** Leave the running game and return to the main menu. */
  readonly onQuit: () => void;
}

const MODAL_PANEL_STYLE = [
  'min-width:220px',
  'display:flex',
  'flex-direction:column',
  'gap:10px',
  'padding:20px',
  'background:rgba(20,16,12,0.96)',
  'color:#e8dcc0',
  'font:15px/1.4 ui-serif,Georgia,serif',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:8px',
  'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
].join(';');

const MODAL_BUTTON_STYLE = [
  'padding:8px 14px',
  'background:rgba(74,63,40,0.9)',
  'color:#e8dcc0',
  'font:inherit',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:5px',
  'cursor:pointer',
].join(';');

/**
 * The in-game system menu behind the tool panel's `options` button: a small centred DOM overlay (the
 * same DOM-over-canvas pattern as the perf and admin panels) whose one action returns to the main menu.
 * A thin first slice — the decoded options window (game settings, help) is a separate ticket
 * (docs/tickets/app/hud-missing-windows.md); this just gives a running session a visible way out.
 * Localized via `messages().hud`.
 */
export function createSystemMenu(deps: SystemMenuDeps): SystemMenu {
  const copy = messages().hud;

  const backdrop = document.createElement('div');
  // Visibility is driven through `display` (not the `hidden` attribute): the centring `display:grid`
  // below is an inline style, which outranks the UA `[hidden]{display:none}` rule — so `hidden` alone
  // would never take. `none` ⇄ `grid` is the real toggle.
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    placeItems: 'center',
    background: 'rgba(0,0,0,0.45)',
    // Above the Pixi canvas and the DOM perf/admin overlays (z 50/150/160); a peer of the hover
    // tooltips (also 2000), which is moot while open — the full-viewport backdrop eats canvas pointer
    // events, so no canvas-driven tooltip fires behind it.
    zIndex: '2000',
  });

  const panel = document.createElement('div');
  panel.style.cssText = MODAL_PANEL_STYLE;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', copy.systemMenu);

  const title = document.createElement('h2');
  title.textContent = copy.systemMenu;
  Object.assign(title.style, { margin: '0 0 6px', font: '18px/1.2 ui-serif,Georgia,serif' });

  const quit = document.createElement('button');
  quit.type = 'button';
  quit.textContent = copy.returnToMenu;
  quit.style.cssText = MODAL_BUTTON_STYLE;
  quit.addEventListener('click', deps.onQuit);

  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = copy.closeMenu;
  close.style.cssText = MODAL_BUTTON_STYLE;

  const hide = (): void => {
    backdrop.style.display = 'none';
  };
  close.addEventListener('click', hide);
  // A click on the dimmed backdrop (outside the panel) also closes — standard dismissable-overlay feel.
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) hide();
  });

  panel.append(title, quit, close);
  backdrop.append(panel);
  document.body.append(backdrop);

  return {
    toggle(): void {
      backdrop.style.display = backdrop.style.display === 'none' ? 'grid' : 'none';
    },
    dispose(): void {
      backdrop.remove();
    },
  };
}
