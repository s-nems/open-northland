import { currentLocale, formatMessage, type Locale, messages, setActiveLocale } from '../i18n/index.js';
import type { DesktopApi, DesktopState, GameFolderCandidate } from '../ipc.js';
import { el } from './dom.js';
import { createModPanel } from './mod-panel.js';
import { createPipelineProgress } from './pipeline-progress.js';

/**
 * The first-run installer page. Phases: pick (path input + browse + auto-detected candidates) →
 * run (progress bar + stage line + log tail) → done | failed. All game-folder knowledge lives
 * behind `window.desktop` ({@link DesktopApi}); this file is DOM glue only. Every user-facing string
 * comes from the installer's i18n catalog, re-applied in {@link renderAll} when the language changes.
 */

declare global {
  interface Window {
    readonly desktop: DesktopApi;
  }
}

/** Pause after the last keystroke before probing the typed path — one probe per pause, not per key. */
const PROBE_DEBOUNCE_MS = 300;

const phases = { pick: el('pick'), run: el('run'), done: el('done'), failed: el('failed') } as const;
const pathInput = el<HTMLInputElement>('game-path');
const probeNote = el('probe-note');
const installButton = el<HTMLButtonElement>('install');

function showPhase(name: keyof typeof phases): void {
  for (const [key, section] of Object.entries(phases)) {
    section.classList.toggle('hidden', key !== name);
  }
}

const progress = createPipelineProgress(showPhase);
const modPanel = createModPanel((root) => {
  externalModRoot = root;
  refreshPick();
});

let validPath: string | undefined;
let candidateHasMod = false;
/** A mod root outside the game folder (downloaded into the data root, or hand-picked). */
let externalModRoot: string | undefined;
/** What the current probe found, so the note can be re-worded on a language switch. */
type ProbeState = 'idle' | 'no-archives' | 'valid';
let probeState: ProbeState = 'idle';
/** Remembered so a language switch can re-derive the page without re-fetching state. */
let dataRootPath = '';
let contentStatus: DesktopState['contentStatus'] = 'missing';

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

/** Word the pick phase for the content status: first install vs recommended vs required regeneration. */
function applyContentStatus(status: DesktopState['contentStatus']): void {
  if (status === 'missing') return;
  const t = messages().setup;
  const note = el('status-note');
  const playNow = el<HTMLButtonElement>('play-now');
  note.classList.remove('hidden');
  installButton.textContent = t.regenerate;
  switch (status) {
    case 'ready':
      note.textContent = t.status.ready;
      playNow.classList.remove('hidden');
      return;
    case 'stale-revision':
      // Also the face of an interrupted conversion (no stamp survives one), hence "incomplete".
      note.textContent = t.status.staleRevision;
      playNow.textContent = t.playAnyway;
      playNow.classList.remove('hidden');
      return;
    case 'stale-schema':
      note.textContent = t.status.staleSchema;
      note.classList.add('blocking');
      return;
    default: {
      const exhaustive: never = status;
      throw new Error(`unhandled content status ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The two flag buttons; each remembers its locale so {@link refreshLangSwitch} needs no id lookup. */
const langButtons: { readonly locale: Locale; readonly button: HTMLButtonElement }[] = [];

function buildLangSwitch(): void {
  const root = el('lang-switch');
  for (const { locale, flag } of [
    { locale: 'pol', flag: '🇵🇱' },
    { locale: 'eng', flag: '🇬🇧' },
  ] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lang-button';
    button.textContent = flag;
    button.addEventListener('click', () => void applyLocale(locale));
    root.append(button);
    langButtons.push({ locale, button });
  }
}

function refreshLangSwitch(): void {
  const copy = messages().setup.language;
  for (const { locale, button } of langButtons) {
    const label = locale === 'pol' ? copy.polish : copy.english;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(currentLocale() === locale));
  }
}

async function applyLocale(locale: Locale): Promise<void> {
  if (currentLocale() === locale) return;
  await window.desktop.setLocale(locale); // persist + re-localize the native menu
  setActiveLocale(locale);
  renderAll();
}

/** Apply the active locale's fixed copy; the `*Html` entries are trusted markup, never user input. */
function applyStaticLabels(): void {
  const t = messages().setup;
  document.title = t.title;
  el('intro').innerHTML = t.introHtml;
  pathInput.placeholder = t.pathPlaceholder;
  el('browse').textContent = t.browse;
  el('detected-label').textContent = t.detected;
  installButton.textContent = t.install;
  el<HTMLButtonElement>('play-now').textContent = t.play;
  el('cancel').textContent = t.cancel;
  el('done-ok').textContent = t.installed;
  el('play').textContent = t.play;
  el('retry').textContent = t.back;
  el('legal').innerHTML = t.legalHtml;
  el('data-root').textContent = dataRootPath; // legalHtml just recreated an empty #data-root
}

/** Re-render every locale-dependent string from the current active locale + remembered state. */
function renderAll(): void {
  applyStaticLabels();
  modPanel.applyLabels();
  progress.relabel(); // the run/failed phase's live stage or failure line owns its own text
  refreshPick();
  applyContentStatus(contentStatus);
  refreshLangSwitch();
}

async function boot(): Promise<void> {
  const state = await window.desktop.getState();
  setActiveLocale(state.locale);
  dataRootPath = state.dataRoot;
  contentStatus = state.contentStatus;
  externalModRoot = state.modRoot;
  buildLangSwitch();
  renderAll();
  if (state.gamePath !== undefined) {
    applyCandidate(await window.desktop.probeGamePath(state.gamePath));
  }
  window.desktop.onPipelineEvent((event) => progress.handleEvent(event));
  window.desktop.onModEvent((event) => modPanel.handleEvent(event));

  const detected = await window.desktop.detectGameFolders();
  if (detected.length > 0) {
    el('detected').classList.remove('hidden');
    const list = el('detected-list');
    for (const candidate of detected) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = candidate.path;
      button.addEventListener('click', () => applyCandidate(candidate));
      list.appendChild(button);
    }
  }

  el('browse').addEventListener('click', async () => {
    const picked = await window.desktop.pickGameFolder();
    if (picked !== null) applyCandidate(picked);
  });
  let probeTimer: number | undefined;
  pathInput.addEventListener('input', () => {
    window.clearTimeout(probeTimer);
    probeTimer = window.setTimeout(() => void probeTyped(), PROBE_DEBOUNCE_MS);
  });
  el('install').addEventListener('click', async () => {
    if (validPath === undefined) return;
    progress.reset();
    showPhase('run');
    try {
      await window.desktop.runPipeline(validPath);
    } catch (err) {
      progress.handleEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
  el('cancel').addEventListener('click', async () => {
    // stop() silences the run's events, so no late error flips the page to the failed phase.
    await window.desktop.stopPipeline();
    showPhase('pick');
  });
  el('play').addEventListener('click', () => void window.desktop.startGame());
  el('play-now').addEventListener('click', () => void window.desktop.startGame());
  el('retry').addEventListener('click', () => showPhase('pick'));
}

void boot();
