import { downloadDiagnosticsBundle, downloadTraceFile, isTraceRecording } from '../diag/index.js';
import { messages } from '../i18n/index.js';
import type { SaveLoadSession } from './runtime/save-load/index.js';
import { buildLoadPanel, buildSavePanel, type SavePanelView } from './save-panels.js';

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
 * The in-game system menu: a centred DOM overlay whose one modal swaps between the root buttons and
 * the save or load panel. It does not implement the original's settings and help window.
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

  const panels: SavePanelView[] = [];
  const hidePanels = (): void => {
    for (const view of panels) view.el.style.display = 'none';
  };
  const showMenu = (): void => {
    hidePanels();
    panel.style.display = 'flex';
  };
  const panelDeps = {
    saveLoad: deps.saveLoad,
    showMenu,
    panelStyle: MODAL_PANEL_STYLE,
    buttonStyle: MODAL_BUTTON_STYLE,
  };
  const savePanel = buildSavePanel(panelDeps);
  const loadPanel = buildLoadPanel(panelDeps);
  panels.push(savePanel, loadPanel);
  hidePanels();

  const showPanel = (view: SavePanelView): void => {
    panel.style.display = 'none';
    hidePanels();
    view.el.style.display = 'flex';
    view.open();
  };

  const save = button(copy.saveGame, () => showPanel(savePanel));
  const load = button(copy.loadGame, () => showPanel(loadPanel));

  const quit = button(copy.returnToMenu, deps.onQuit);

  // The same report path the crash banner offers, also reachable without a crash.
  const diagnostics = button(copy.downloadDiagnostics, () => downloadDiagnosticsBundle());

  // Present only while a `?debug=trace` recording is live.
  const trace = isTraceRecording() ? button(copy.downloadTrace, () => downloadTraceFile()) : null;

  const hide = (): void => {
    backdrop.style.display = 'none';
    deps.saveLoad.releaseForcedPause();
    showMenu();
  };
  const close = button(copy.closeMenu, hide);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) hide();
  });
  // Escape steps back one level: panel to the root buttons, root to the game. The confirm dialog
  // handles its own Escape in the capture phase and stops it from reaching here.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || backdrop.style.display === 'none') return;
    if (panel.style.display === 'none') showMenu();
    else hide();
  };
  document.addEventListener('keydown', onKey);

  panel.append(title, save, load, quit, diagnostics, ...(trace !== null ? [trace] : []), close);
  backdrop.append(panel, savePanel.el, loadPanel.el);
  document.body.append(backdrop);

  return {
    toggle(): void {
      if (backdrop.style.display === 'none') {
        // The whole menu holds the pause, so the sim never runs behind the dimmed backdrop.
        deps.saveLoad.forcePause();
        backdrop.style.display = 'grid';
      } else {
        hide();
      }
    },
    dispose(): void {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
    },
  };
}
