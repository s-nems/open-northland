import { formatMessage, messages } from '../i18n/index.js';
import type { DesktopState, GameFolderCandidate, ModEvent } from '../ipc.js';
import { el } from './dom.js';
import { createModPanel } from './mod-panel.js';

/**
 * The wizard's first phase: choose the original game folder (typed, browsed, or auto-detected), get
 * a usable culturesnation mod alongside it, and hand a validated game path to the conversion. Owns
 * the `#pick` section — including the mod step nested inside it — and every piece of state that
 * section's wording depends on.
 */

/** Pause after the last keystroke before probing the typed path — one probe per pause, not per key. */
const PROBE_DEBOUNCE_MS = 300;

/** What the current probe found, so the note can be re-worded on a language switch. */
type ProbeState = 'idle' | 'no-archives' | 'valid';

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

  let validPath: string | undefined;
  let candidateHasMod = false;
  /** A mod root outside the game folder (downloaded into the data root, or hand-picked). */
  let externalModRoot: string | undefined;
  let probeState: ProbeState = 'idle';
  /** Remembered so a language switch can re-derive the phase without re-fetching the shell state. */
  let contentStatus: DesktopState['contentStatus'] = 'missing';

  const modPanel = createModPanel((root) => {
    externalModRoot = root;
    refreshPick();
  });

  /** The active locale's probe note for the current find. */
  function renderProbe(): void {
    const t = messages().setup;
    switch (probeState) {
      case 'idle':
        probeNote.textContent = '';
        return;
      case 'no-archives':
        probeNote.textContent = t.probe.noArchives;
        return;
      case 'valid':
        probeNote.textContent = candidateHasMod
          ? t.probe.withMod
          : externalModRoot !== undefined
            ? formatMessage(t.probe.externalMod, { path: externalModRoot })
            : t.probe.noMod;
        return;
    }
  }

  /** Re-word the probe note + install/mod-panel visibility for the current game/mod availability. */
  function refreshPick(): void {
    if (validPath === undefined) {
      installButton.disabled = true;
      modPanel.setVisible(false);
    } else {
      probeState = 'valid';
      const modReady = candidateHasMod || externalModRoot !== undefined;
      modPanel.setVisible(!modReady);
      installButton.disabled = !modReady;
    }
    renderProbe();
  }

  /** `fillInput` is off when the probe echoes what the user is typing — never fight the caret. */
  function applyCandidate(candidate: GameFolderCandidate, fillInput = true): void {
    if (fillInput) pathInput.value = candidate.path;
    if (candidate.probe.hasArchives) {
      validPath = candidate.path;
      candidateHasMod = candidate.probe.hasMod;
    } else {
      validPath = undefined;
      probeState = 'no-archives';
    }
    refreshPick();
  }

  let probeGeneration = 0;

  async function probeTyped(): Promise<void> {
    const generation = ++probeGeneration;
    const typed = pathInput.value.trim();
    if (typed === '') {
      validPath = undefined;
      probeState = 'idle';
      refreshPick();
      return;
    }
    const candidate = await window.desktop.probeGamePath(typed);
    if (generation !== probeGeneration) return; // a newer keystroke's probe is already in flight
    applyCandidate(candidate, false);
  }

  /** Word the phase for the content status: first install vs recommended vs required regeneration. */
  function applyContentStatus(): void {
    if (contentStatus === 'missing') return;
    const t = messages().setup;
    statusNote.classList.remove('hidden');
    installButton.textContent = t.regenerate;
    switch (contentStatus) {
      case 'ready':
        statusNote.textContent = t.status.ready;
        playNowButton.classList.remove('hidden');
        return;
      case 'stale-revision':
        // Also the face of an interrupted conversion (no stamp survives one), hence "incomplete".
        statusNote.textContent = t.status.staleRevision;
        playNowButton.textContent = t.playAnyway;
        playNowButton.classList.remove('hidden');
        return;
      case 'stale-schema':
        statusNote.textContent = t.status.staleSchema;
        statusNote.classList.add('blocking');
        return;
      default: {
        const exhaustive: never = contentStatus;
        throw new Error(`unhandled content status ${JSON.stringify(exhaustive)}`);
      }
    }
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
      if (validPath !== undefined) onInstall(validPath);
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
      installButton.textContent = t.install;
      playNowButton.textContent = t.play;
      modPanel.applyLabels();
      refreshPick();
      applyContentStatus();
    },
  };
}
