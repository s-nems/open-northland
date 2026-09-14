import type { ContentStatus } from '../content-state.js';
import type { ModDelivery, ModEvent, ModInstallApi, ShellSetupState } from '../shell-api.js';
import { el } from './dom.js';
import { createModPanel } from './mod-panel.js';
import { pickView } from './pick-view.js';

export interface PickPanelView {
  applyState(state: ShellSetupState): void;
  /** Wires the controls, so it must run after {@link applyState}: no click may land first. */
  start(): void;
  handleModEvent(event: ModEvent): void;
  applyLabels(): void;
}

export interface PickPanelHandlers {
  onInstall(): void;
  onPlay(): void;
}

export function createPickPanel(api: ModInstallApi, { onInstall, onPlay }: PickPanelHandlers): PickPanelView {
  const modStatus = el('mod-status');
  const statusNote = el('status-note');
  const installButton = el<HTMLButtonElement>('install');
  const playNowButton = el<HTMLButtonElement>('play-now');

  let modRoot: string | undefined;
  /** Remembered so a language switch can re-derive the phase without re-fetching the shell state. */
  let contentStatus: ContentStatus = 'missing';
  let modDelivery: ModDelivery = 'upstream-folder';

  const modPanel = createModPanel(
    api,
    (root) => {
      modRoot = root;
      render();
    },
    () => modDelivery,
  );

  /** Every state change repaints the section through here. */
  function render(): void {
    const view = pickView({ modRoot, contentStatus });
    modStatus.textContent = view.modNote;
    modStatus.classList.toggle('hidden', view.modNote === '');
    modPanel.setVisible(view.modPanelVisible);
    installButton.disabled = view.installDisabled;
    installButton.textContent = view.installLabel;
    statusNote.textContent = view.statusNote?.text ?? '';
    statusNote.classList.toggle('hidden', view.statusNote === undefined);
    statusNote.classList.toggle('blocking', view.statusNote?.blocking === true);
    playNowButton.textContent = view.playNowLabel ?? '';
    playNowButton.classList.toggle('hidden', view.playNowLabel === undefined);
  }

  return {
    applyState(state: ShellSetupState): void {
      contentStatus = state.contentStatus;
      modDelivery = state.modDelivery;
      // The mod panel is live from construction, so a mod resolved while this state was in flight
      // outranks the older startup answer.
      modRoot ??= state.modRoot;
    },

    start(): void {
      installButton.addEventListener('click', () => onInstall());
      playNowButton.addEventListener('click', () => onPlay());
    },

    handleModEvent: modPanel.handleEvent,

    applyLabels(): void {
      modPanel.applyLabels();
      render();
    },
  };
}
