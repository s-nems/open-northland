import type { ContentStatus } from '../content-state.js';
import { messages } from '../i18n/index.js';
import type { DesktopState, GameFolderCandidate, ModEvent } from '../ipc.js';
import { el } from './dom.js';
import { createModPanel } from './mod-panel.js';
import { type Probe, pickView } from './pick-view.js';

/**
 * The wizard's first phase: choose the original game folder (typed, browsed, or auto-detected), get
 * a usable culturesnation mod alongside it, and hand a validated game path to the conversion. Owns
 * the `#pick` section - including the mod step nested inside it - and every piece of state that
 * section's wording depends on; {@link pickView} turns that state into the section's view.
 */

/** Pause after the last keystroke before probing the typed path - one probe per pause, not per key. */
const PROBE_DEBOUNCE_MS = 300;

export interface PickPanelView {
  /** Adopt the shell's startup state: the installed content's status and any mod already available. */
  applyState(state: DesktopState): void;
  /**
   * Open the phase for input: probe the remembered game folder, wire the controls, then offer the
   * auto-detected candidates. Called after {@link applyState}, which must not race a user's pick.
   */
  start(rememberedGamePath: string | undefined): Promise<void>;
  handleModEvent(event: ModEvent): void;
  /** (Re-)apply every string this phase owns for the active locale. */
  applyLabels(): void;
}

export interface PickPanelHandlers {
  /** A validated game folder is ready to convert. */
  onInstall(gamePath: string): void;
  /** Boot the already-installed content instead of regenerating it. */
  onPlay(): void;
}

export function createPickPanel({ onInstall, onPlay }: PickPanelHandlers): PickPanelView {
  const pathInput = el<HTMLInputElement>('game-path');
  const probeNote = el('probe-note');
  const statusNote = el('status-note');
  const installButton = el<HTMLButtonElement>('install');
  const playNowButton = el<HTMLButtonElement>('play-now');

  let probe: Probe = { kind: 'idle' };
  let externalModRoot: string | undefined;
  /** Remembered so a language switch can re-derive the phase without re-fetching the shell state. */
  let contentStatus: ContentStatus = 'missing';

  const modPanel = createModPanel((root) => {
    externalModRoot = root;
    render();
  });

  /** Paint the section from the derived view; every state change comes back through here. */
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

  /** `fillInput` is off when the probe echoes what the user is typing - never fight the caret. */
  function applyCandidate(candidate: GameFolderCandidate, fillInput = true): void {
    if (fillInput) pathInput.value = candidate.path;
    probe = candidate.probe.hasArchives
      ? { kind: 'valid', path: candidate.path, hasMod: candidate.probe.hasMod }
      : { kind: 'no-archives' };
    render();
  }

  let probeGeneration = 0;

  async function probeTyped(): Promise<void> {
    const generation = ++probeGeneration;
    const typed = pathInput.value.trim();
    if (typed === '') {
      probe = { kind: 'idle' };
      render();
      return;
    }
    const candidate = await window.desktop.probeGamePath(typed);
    if (generation !== probeGeneration) return; // a newer keystroke's probe is already in flight
    applyCandidate(candidate, false);
  }

  /** Wire the phase's controls. Deferred to {@link PickPanelView.start} so no click can land on
   *  state the shell has not delivered yet. */
  function listen(): void {
    el('browse').addEventListener('click', async () => {
      const picked = await window.desktop.pickGameFolder();
      if (picked !== null) applyCandidate(picked);
    });
    let probeTimer: number | undefined;
    pathInput.addEventListener('input', () => {
      window.clearTimeout(probeTimer);
      probeTimer = window.setTimeout(() => void probeTyped(), PROBE_DEBOUNCE_MS);
    });
    installButton.addEventListener('click', () => {
      if (probe.kind === 'valid') onInstall(probe.path);
    });
    playNowButton.addEventListener('click', () => onPlay());
  }

  return {
    applyState(state: DesktopState): void {
      contentStatus = state.contentStatus;
      // The mod panel's buttons are live from construction, so a mod the user resolved while the
      // shell state was in flight outranks the (necessarily older) startup answer.
      externalModRoot ??= state.modRoot;
    },

    async start(rememberedGamePath: string | undefined): Promise<void> {
      if (rememberedGamePath !== undefined) {
        applyCandidate(await window.desktop.probeGamePath(rememberedGamePath));
      }
      listen();
      const detected = await window.desktop.detectGameFolders();
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
      el('browse').textContent = t.browse;
      el('detected-label').textContent = t.detected;
      modPanel.applyLabels();
      render();
    },
  };
}
