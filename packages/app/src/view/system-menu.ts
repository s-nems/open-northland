import { downloadDiagnosticsBundle, downloadTraceFile, isTraceRecording } from '../diag/index.js';
import { messages } from '../i18n/index.js';
import type { SaveLoadSession } from './runtime/save-load/index.js';

export interface SystemMenu {
  toggle(): void;
  dispose(): void;
}

export interface SystemMenuDeps {
  /** Leave the running game and return to the main menu. */
  readonly onQuit: () => void;
  /** The save and load flows behind the two game buttons. */
  readonly saveLoad: SaveLoadSession;
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
 * The in-game system menu: a centred DOM overlay for saving and loading, returning to the main menu
 * and downloading diagnostics. It does not implement the original's settings and help window.
 */
export function createSystemMenu(deps: SystemMenuDeps): SystemMenu {
  const copy = messages().hud;

  const backdrop = document.createElement('div');
  // Visibility toggles `display`, not the `hidden` attribute: the inline `grid` below outranks the UA
  // `[hidden]{display:none}` rule.
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    placeItems: 'center',
    background: 'rgba(0,0,0,0.45)',
    // Above the Pixi canvas and the DOM perf/admin overlays (z 50/150/160).
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

  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.style.cssText = MODAL_BUTTON_STYLE;
    el.addEventListener('click', onClick);
    return el;
  };

  // Save and load outcomes land here; anything else (a cancel, a page reload) leaves it hidden.
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  Object.assign(status.style, { margin: '0', font: '13px/1.4 ui-serif,Georgia,serif', display: 'none' });
  const setStatus = (text: string | null): void => {
    status.textContent = text ?? '';
    status.style.display = text === null ? 'none' : 'block';
  };

  // One flow at a time: a second click while a file dialog is open would stack a second dialog.
  let busy = false;
  const runFlow = (flow: () => Promise<string | null>): void => {
    if (busy) return;
    busy = true;
    setStatus(null);
    void flow()
      .then(setStatus)
      .finally(() => {
        busy = false;
      });
  };

  const save = button(copy.saveGame, () =>
    runFlow(async () => {
      const outcome = await deps.saveLoad.saveGame();
      if (outcome.kind === 'saved') return copy.gameSaved;
      return outcome.kind === 'failed' ? copy.saveFailed : null;
    }),
  );
  const load = button(copy.loadGame, () =>
    runFlow(async () => {
      const outcome = await deps.saveLoad.loadGame();
      return outcome.kind === 'rejected' ? copy.loadErrors[outcome.reason] : null;
    }),
  );

  const quit = button(copy.returnToMenu, deps.onQuit);

  // The same report path the crash banner offers, also reachable without a crash.
  const diagnostics = button(copy.downloadDiagnostics, () => downloadDiagnosticsBundle());

  // Present only while a `?debug=trace` recording is live.
  const trace = isTraceRecording() ? button(copy.downloadTrace, () => downloadTraceFile()) : null;

  const hide = (): void => {
    backdrop.style.display = 'none';
    setStatus(null);
    // Browsers without the file input's `cancel` event leave the load flow pending forever; closing
    // the menu is the player's way out, so it releases both the forced pause and the busy latch.
    busy = false;
    deps.saveLoad.releaseForcedPause();
  };
  const close = button(copy.closeMenu, hide);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) hide();
  });

  panel.append(title, save, load, quit, diagnostics, ...(trace !== null ? [trace] : []), close, status);
  backdrop.append(panel);
  document.body.append(backdrop);

  return {
    toggle(): void {
      if (backdrop.style.display === 'none') backdrop.style.display = 'grid';
      else hide();
    },
    dispose(): void {
      backdrop.remove();
    },
  };
}
