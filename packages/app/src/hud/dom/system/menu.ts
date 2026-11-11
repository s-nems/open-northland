import { downloadDiagnosticsBundle, downloadTraceFile, isTraceRecording } from '../../../diag/index.js';
import { isReportDialog } from '../../../diag/report/dialog.js';
import { openBugReportForm } from '../../../diag/report/flow.js';
import { messages } from '../../../i18n/index.js';
import { dismissOnBackdropClick } from '../../../view/backdrop-dismiss.js';
import type { GameSettingsRuntime } from '../../../view/runtime/game-settings.js';
import type { SaveLoadSession } from '../../../view/runtime/save-load/index.js';
import type { MenuSettings } from '../../../view/settings/store.js';
import { GLYPH } from '../icons.js';
import { type ReplayOffer, replayQuestion } from '../match-result.js';
import { createHudPlane, type HudPlane } from '../root.js';
import type { MenuPageView } from '../save-window/frame.js';
import { createLoadWindow } from '../save-window/load-window.js';
import { createSaveWindow } from '../save-window/save-window.js';
import { createHudWindow } from '../window.js';
import { createSystemConfirm } from './confirm.js';
import { createSystemSettings } from './settings.js';

export type SystemMenuPage = 'save' | 'load';
export interface SystemMenu {
  toggle(): void;
  close(): void;
  /** `onClosed` runs once when the menu next closes, unless it is disposed first. */
  openPage(page: SystemMenuPage, onClosed?: () => void): void;
  isOpen(): boolean;
  dispose(): void;
}
export interface SystemMenuDeps {
  readonly onQuit: () => void;
  /** Absent where a fresh boot cannot replay the world. */
  readonly restart?: ReplayOffer;
  readonly saveLoad: SaveLoadSession;
  readonly settings: GameSettingsRuntime;
  readonly hud: Pick<HudPlane, 'element' | 'currentScale'>;
  readonly setCameraSuspended: (suspended: boolean) => void;
  readonly canLoad?: boolean;
  readonly pauseStopsClock?: boolean;
  readonly onNetwork?: () => void;
  /** The settings page closed, with the settings it opened on and the ones it leaves. */
  readonly onSettingsLeft?: (opened: MenuSettings, closed: MenuSettings) => void;
}

/** Owns the menu's pause and keyboard across its root and its settings, save and load pages. */
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
  frame.element.querySelector('.on-window__close')?.remove();
  frame.element.classList.add('on-system-dialog', 'on-system-menu');
  frame.element.setAttribute('role', 'dialog');
  frame.element.setAttribute('aria-modal', 'true');
  const confirm = createSystemConfirm(plane.element);
  let previousFocus: Element | null = null;
  let returnFocus: HTMLButtonElement | null = null;
  let activePanel: HTMLElement = frame.element;
  let onClosed: (() => void) | null = null;
  const inert = new Map<HTMLElement, boolean>();
  const pages: MenuPageView[] = [];
  const hidePanels = (): void => {
    for (const page of pages) page.close();
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
    const closed = onClosed;
    onClosed = null;
    closed?.();
  };
  const pageDeps = {
    plane: plane.element,
    saveLoad: deps.saveLoad,
    confirm: confirm.open,
    signal: scope.signal,
    onBack: showMenu,
    onClose: hide,
  };
  const savePanel = createSaveWindow({ ...pageDeps, settings: deps.settings });
  const loadPanel = createLoadWindow(pageDeps);
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
    ...(deps.onSettingsLeft !== undefined ? { onLeave: deps.onSettingsLeft } : {}),
  });
  pages.push(savePanel, loadPanel, settingsPanel);
  const showPanel = (page: MenuPageView, trigger: HTMLButtonElement): void => {
    returnFocus = trigger;
    frame.close();
    hidePanels();
    activePanel = page.el;
    page.open();
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
  resume.classList.add('on-button--primary', 'on-system-menu__resume');
  const esc = document.createElement('kbd');
  esc.textContent = 'Esc';
  resume.append(esc);
  const save = button(copy.saveGame, GLYPH.papers, () => showPanel(savePanel, save));
  const load = button(copy.loadGame, GLYPH.book, () => showPanel(loadPanel, load));
  const settings = button(messages().mainMenu.items.settings, GLYPH.wheel, () =>
    showPanel(settingsPanel, settings),
  );
  const quit = button(text.leaveGame, GLYPH.exit, () => {
    void confirm
      .open({
        title: text.leaveGame,
        message: copy.quitConfirm,
        cancel: text.cancel,
        confirm: copy.quitConfirmYes,
      })
      .then((confirmed) => {
        if (confirmed && !scope.signal.aborted) deps.onQuit();
      });
  });
  quit.classList.add('on-system-menu__quit');
  const offer = deps.restart;
  const restart =
    offer === undefined
      ? null
      : button(text.restartMission, GLYPH.replay, () => {
          void confirm
            .open({
              title: text.restartMission,
              message: replayQuestion(offer),
              cancel: text.cancel,
              confirm: text.restartMission,
            })
            .then((confirmed) => {
              if (confirmed && !scope.signal.aborted) offer.start();
            });
        });
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
    button(messages().bugReport.titles.manual, GLYPH.pen, openBugReportForm),
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
  if (restart !== null) frame.body.append(restart);
  frame.body.append(quit, support);
  document.body.append(backdrop);
  hidePanels();
  dismissOnBackdropClick([backdrop], hide);
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
          'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), summary, [tabindex="0"]',
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
      // An open bug report dialog stands above the menu and stays usable.
      if (child instanceof HTMLElement && child !== backdrop && !isReportDialog(child)) {
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
    close: hide,
    openPage(page, closed): void {
      if (page === 'load' && deps.canLoad === false) return;
      if (backdrop.hidden) show();
      if (closed !== undefined) onClosed = closed;
      showPanel(page === 'save' ? savePanel : loadPanel, page === 'save' ? save : load);
    },
    dispose(): void {
      onClosed = null;
      hide();
      scope.abort();
      resize.disconnect();
      backdrop.remove();
    },
  };
}
