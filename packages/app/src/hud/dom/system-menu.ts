import { downloadDiagnosticsBundle, downloadTraceFile, isTraceRecording } from '../../diag/index.js';
import { messages } from '../../i18n/index.js';
import type { GameSettingsRuntime } from '../../view/runtime/game-settings.js';
import type { SaveLoadSession } from '../../view/runtime/save-load/index.js';
import { buildLoadPanel, buildSavePanel, type SavePanelView } from '../../view/save-panels/index.js';
import { SAVE_BUTTON_STYLE, SAVE_PANEL_STYLE } from '../../view/save-panels/parts.js';
import { GLYPH } from './icons.js';
import { createHudPlane, type HudPlane } from './root.js';
import { createSystemConfirm } from './system-confirm.js';
import { createSystemSettings } from './system-settings.js';
import { createHudWindow } from './window.js';

export type SystemMenuPage = 'save' | 'load';
export interface SystemMenu {
  toggle(): void;
  openPage(page: SystemMenuPage): void;
  isOpen(): boolean;
  dispose(): void;
}
export interface SystemMenuDeps {
  readonly onQuit: () => void;
  readonly saveLoad: SaveLoadSession;
  readonly settings: GameSettingsRuntime;
  readonly hud: Pick<HudPlane, 'element' | 'currentScale'>;
  readonly setCameraSuspended: (suspended: boolean) => void;
  readonly canLoad?: boolean;
  readonly pauseStopsClock?: boolean;
  readonly onNetwork?: () => void;
}

/** Owns the menu's pause and keyboard across root, settings and the existing save/load pages. */
export function createSystemMenu(deps: SystemMenuDeps): SystemMenu {
  const scope = new AbortController();
  const copy = messages().hud;
  const text = copy.systemMenuDetails;
  const backdrop = document.createElement('div');
  backdrop.className = 'on-system-backdrop';
  backdrop.hidden = true;
  const scale = deps.hud.currentScale;
  const plane = createHudPlane(scale());
  plane.element.classList.add('on-system-plane');
  backdrop.append(plane.element);
  const frame = createHudWindow(plane.element, {
    title: copy.systemMenu,
    subtitle: deps.pauseStopsClock === false ? text.multiplayer : text.paused,
    closeLabel: text.resume,
    width: 300,
    compact: true,
  });
  frame.element.classList.add('on-system-dialog', 'on-system-menu');
  frame.element.setAttribute('role', 'dialog');
  frame.element.setAttribute('aria-modal', 'true');
  const confirm = createSystemConfirm(plane.element);
  let previousFocus: Element | null = null;
  let returnFocus: HTMLButtonElement | null = null;
  let activePanel: HTMLElement = frame.element;
  const inert = new Map<HTMLElement, boolean>();
  const panels: SavePanelView[] = [];
  const hidePanels = (): void => {
    for (const view of panels) view.el.style.display = 'none';
    settingsPanel.close();
  };
  const showMenu = (): void => {
    hidePanels();
    frame.open();
    activePanel = frame.element;
    (returnFocus ?? resume).focus();
  };
  const hide = (): void => {
    if (backdrop.hidden) return;
    confirm.cancel();
    hidePanels();
    backdrop.hidden = true;
    deps.setCameraSuspended(false);
    deps.saveLoad.releaseForcedPause();
    for (const [element, prior] of inert) element.inert = prior;
    inert.clear();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  };
  frame.onDismiss(hide);
  const panelDeps = {
    saveLoad: deps.saveLoad,
    showMenu,
    panelStyle: SAVE_PANEL_STYLE,
    buttonStyle: SAVE_BUTTON_STYLE,
  };
  const savePanel = buildSavePanel(panelDeps);
  const loadPanel = buildLoadPanel(panelDeps);
  panels.push(savePanel, loadPanel);
  const syncScale = (): void => {
    void plane.setUiScale(scale());
  };
  const settingsPanel = createSystemSettings({
    plane: plane.element,
    settings: deps.settings,
    signal: scope.signal,
    onBack: showMenu,
    onClose: hide,
    confirmRestore: () => {
      const copy = messages();
      return confirm.open({
        title: copy.hud.systemMenuDetails.restoreTitle,
        message: copy.hud.systemMenuDetails.restoreMessage,
        cancel: copy.hud.systemMenuDetails.cancel,
        confirm: copy.mainMenu.settings.restoreDefaults,
      });
    },
  });
  const showPanel = (view: SavePanelView, trigger: HTMLButtonElement): void => {
    returnFocus = trigger;
    frame.close();
    hidePanels();
    activePanel = view.el;
    view.el.style.display = 'flex';
    view.open();
    if (!view.el.contains(document.activeElement)) view.el.querySelector<HTMLElement>('button')?.focus();
  };
  const button = (label: string, glyph: string, action: () => void): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'on-button on-system-menu__action';
    button.innerHTML = glyph;
    const name = document.createElement('span');
    name.textContent = label;
    button.append(name);
    button.addEventListener('click', action);
    return button;
  };
  const resume = button(text.resume, GLYPH.next, hide);
  resume.classList.add('on-system-menu__resume');
  const esc = document.createElement('kbd');
  esc.textContent = 'Esc';
  resume.append(esc);
  const save = button(copy.saveGame, GLYPH.papers, () => showPanel(savePanel, save));
  const load = button(copy.loadGame, GLYPH.book, () => showPanel(loadPanel, load));
  const settings = button(messages().mainMenu.items.settings, GLYPH.wheel, () => {
    returnFocus = settings;
    frame.close();
    hidePanels();
    activePanel = settingsPanel.el;
    settingsPanel.open();
  });
  const quit = button(copy.returnToMenu, GLYPH.arrowLeft, () => {
    void confirm
      .open({
        title: copy.returnToMenu,
        message: copy.quitConfirm,
        cancel: text.cancel,
        confirm: copy.quitConfirmYes,
      })
      .then((confirmed) => {
        if (confirmed && !scope.signal.aborted) deps.onQuit();
      });
  });
  quit.classList.add('on-system-menu__quit');
  const saves = document.createElement('div');
  saves.className = 'on-system-menu__saves';
  saves.append(save);
  if (deps.canLoad !== false) saves.append(load);
  const support = document.createElement('details');
  support.className = 'on-system-menu__support';
  const summary = document.createElement('summary');
  summary.textContent = text.support;
  support.append(
    summary,
    button(copy.downloadDiagnostics, GLYPH.scroll, () => void downloadDiagnosticsBundle()),
  );
  if (isTraceRecording()) support.append(button(copy.downloadTrace, GLYPH.scroll, downloadTraceFile));
  frame.body.append(resume, saves, settings);
  const onNetwork = deps.onNetwork;
  if (onNetwork !== undefined)
    frame.body.append(
      button(copy.network.title, GLYPH.people, () => {
        hide();
        onNetwork();
      }),
    );
  frame.body.append(quit, support);
  backdrop.append(savePanel.el, loadPanel.el);
  document.body.append(backdrop);
  hidePanels();
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) hide();
  });
  const onKey = (event: KeyboardEvent): void => {
    if (backdrop.hidden) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirm.isOpen()) confirm.cancel();
      else if (activePanel !== frame.element) showMenu();
      else hide();
    } else if (event.key === 'Tab') {
      const panel = plane.element.querySelector('[role="alertdialog"]') ?? activePanel;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
        ),
      ].filter((el) => el.closest('details:not([open])') === null || el.tagName === 'SUMMARY');
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, { signal: scope.signal });
  // Follow the committed HUD scale. Window resize fires before the game's viewport has settled.
  const resize = new ResizeObserver(() => {
    syncScale();
    settingsPanel.refresh();
  });
  resize.observe(deps.hud.element);
  const show = (): void => {
    previousFocus = document.activeElement;
    for (const child of document.body.children) {
      if (child instanceof HTMLElement && child !== backdrop) {
        inert.set(child, child.inert);
        child.inert = true;
      }
    }
    deps.saveLoad.forcePause();
    deps.setCameraSuspended(true);
    syncScale();
    backdrop.hidden = false;
    returnFocus = null;
    showMenu();
  };
  return {
    isOpen: () => !backdrop.hidden,
    toggle(): void {
      if (backdrop.hidden) show();
      else hide();
    },
    openPage(page): void {
      if (page === 'load' && deps.canLoad === false) return;
      if (backdrop.hidden) show();
      showPanel(page === 'save' ? savePanel : loadPanel, page === 'save' ? save : load);
    },
    dispose(): void {
      hide();
      scope.abort();
      resize.disconnect();
      backdrop.remove();
    },
  };
}
