import type { ContentStatus } from '../content-state.js';
import { messages } from '../i18n/index.js';
import type { GameFolderCandidate, ModEvent, ShellApi, ShellSetupState } from '../shell-api.js';
import { el } from './dom.js';
import { createModPanel } from './mod-panel.js';
import { type Probe, pickView } from './pick-view.js';

const PROBE_DEBOUNCE_MS = 300;

export interface PickPanelView {
  applyState(state: ShellSetupState): void;
  /** Wires the controls, so it must run after {@link applyState}: no click may land first. */
  start(rememberedGamePath: string | undefined): Promise<void>;
  handleModEvent(event: ModEvent): void;
  applyLabels(): void;
}

export interface PickPanelHandlers {
  onInstall(gamePath: string): void;
  onPlay(): void;
}

export function createPickPanel(api: ShellApi, { onInstall, onPlay }: PickPanelHandlers): PickPanelView {
  const pathInput = el<HTMLInputElement>('game-path');
  const probeNote = el('probe-note');
  const statusNote = el('status-note');
  const installButton = el<HTMLButtonElement>('install');
  const playNowButton = el<HTMLButtonElement>('play-now');
  const dropZone = el('drop-zone');

  let probe: Probe = { kind: 'idle' };
  let externalModRoot: string | undefined;
  /** Remembered so a language switch can re-derive the phase without re-fetching the shell state. */
  let contentStatus: ContentStatus = 'missing';

  const modPanel = createModPanel(api, (root) => {
    externalModRoot = root;
    render();
  });

  /** Every state change repaints the section through here. */
  function render(): void {
    const view = pickView({ probe, externalModRoot, contentStatus });
    probeNote.textContent = view.probeNote;
    modPanel.setVisible(view.modPanelVisible);
    installButton.disabled = view.installDisabled;
    installButton.textContent = view.installLabel;
    statusNote.textContent = view.statusNote?.text ?? '';
    statusNote.classList.toggle('hidden', view.statusNote === undefined);
    statusNote.classList.toggle('blocking', view.statusNote?.blocking === true);
    playNowButton.textContent = view.playNowLabel ?? '';
    playNowButton.classList.toggle('hidden', view.playNowLabel === undefined);
  }

  /** `fillInput` is off while the user is typing - never fight the caret. */
  function applyCandidate(candidate: GameFolderCandidate, fillInput = true): void {
    if (fillInput) pathInput.value = candidate.path;
    probe = candidate.probe.hasArchives
      ? { kind: 'valid', path: candidate.path, hasMod: candidate.probe.hasMod }
      : { kind: 'no-archives' };
    render();
  }

  let probeGeneration = 0;

  async function probeTyped(probeGamePath: (path: string) => Promise<GameFolderCandidate>): Promise<void> {
    const generation = ++probeGeneration;
    const typed = pathInput.value.trim();
    if (typed === '') {
      probe = { kind: 'idle' };
      render();
      return;
    }
    const candidate = await probeGamePath(typed);
    if (generation !== probeGeneration) return; // a newer keystroke's probe is already in flight
    applyCandidate(candidate, false);
  }

  function listenDropZone(handleDrop: NonNullable<ShellApi['handleDrop']>): void {
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
      const transfer = event.dataTransfer;
      if (transfer === null) return;
      void handleDrop(transfer).then((candidate) => {
        if (candidate !== null) applyCandidate(candidate);
      });
    });
  }

  function listen(): void {
    el('browse').addEventListener('click', async () => {
      const picked = await api.pickGameFolder();
      if (picked !== null) applyCandidate(picked);
    });
    const probeGamePath = api.probeGamePath?.bind(api);
    if (probeGamePath !== undefined) {
      let probeTimer: number | undefined;
      pathInput.addEventListener('input', () => {
        window.clearTimeout(probeTimer);
        probeTimer = window.setTimeout(() => void probeTyped(probeGamePath), PROBE_DEBOUNCE_MS);
      });
    }
    const handleDrop = api.handleDrop?.bind(api);
    if (handleDrop !== undefined) listenDropZone(handleDrop);
    installButton.addEventListener('click', () => {
      if (probe.kind === 'valid') onInstall(probe.path);
    });
    playNowButton.addEventListener('click', () => onPlay());
  }

  return {
    applyState(state: ShellSetupState): void {
      contentStatus = state.contentStatus;
      // The mod panel is live from construction, so a mod resolved while this state was in flight
      // outranks the older startup answer.
      externalModRoot ??= state.modRoot;
    },

    async start(rememberedGamePath: string | undefined): Promise<void> {
      pathInput.classList.toggle('hidden', api.probeGamePath === undefined);
      dropZone.classList.toggle('hidden', api.handleDrop === undefined);
      if (rememberedGamePath !== undefined && api.probeGamePath !== undefined) {
        applyCandidate(await api.probeGamePath(rememberedGamePath));
      }
      listen();
      const detected = (await api.detectGameFolders?.()) ?? [];
      if (detected.length === 0) return;
      el('detected').classList.remove('hidden');
      const list = el('detected-list');
      for (const candidate of detected) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = candidate.path;
        button.addEventListener('click', () => applyCandidate(candidate));
        list.appendChild(button);
      }
    },

    handleModEvent: modPanel.handleEvent,

    applyLabels(): void {
      const t = messages().setup;
      pathInput.placeholder = t.pathPlaceholder;
      el('drop-zone-label').textContent = t.dropPrompt;
      el('browse').textContent = t.browse;
      el('detected-label').textContent = t.detected;
      modPanel.applyLabels();
      render();
    },
  };
}
