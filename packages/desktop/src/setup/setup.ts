import type { DesktopApi, DesktopState, GameFolderCandidate, PipelineEvent } from '../ipc.js';
import { overallFraction, STAGE_LABELS } from '../progress-model.js';

/**
 * The first-run installer page. Phases: pick (path input + browse + auto-detected candidates) →
 * run (progress bar + stage line + log tail) → done | failed. All game-folder knowledge lives
 * behind `window.desktop` ({@link DesktopApi}); this file is DOM glue only.
 */

declare global {
  interface Window {
    readonly desktop: DesktopApi;
  }
}

const LOG_TAIL_LINES = 8;
/** Pause after the last keystroke before probing the typed path — one probe per pause, not per key. */
const PROBE_DEBOUNCE_MS = 300;

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`setup page is missing #${id}`);
  return found as T;
};

const phases = { pick: el('pick'), run: el('run'), done: el('done'), failed: el('failed') } as const;
const pathInput = el<HTMLInputElement>('game-path');
const probeNote = el('probe-note');
const installButton = el<HTMLButtonElement>('install');
const barFill = el('bar-fill');
const stageLabel = el('stage-label');
const itemCount = el('item-count');
const logTail = el('log-tail');

function showPhase(name: keyof typeof phases): void {
  for (const [key, section] of Object.entries(phases)) {
    section.classList.toggle('hidden', key !== name);
  }
}

let validPath: string | undefined;

/** `fillInput` is off when the probe echoes what the user is typing — never fight the caret. */
function applyCandidate(candidate: GameFolderCandidate, fillInput = true): void {
  if (fillInput) pathInput.value = candidate.path;
  if (candidate.probe.hasArchives) {
    validPath = candidate.path;
    probeNote.textContent = candidate.probe.hasMod
      ? 'Game found (with the culturesnation mod).'
      : 'Game found.';
    installButton.disabled = false;
  } else {
    validPath = undefined;
    probeNote.textContent =
      'No game archives (.lib) found there — pick the folder that contains Game.exe and DataX.';
    installButton.disabled = true;
  }
}

let probeGeneration = 0;

async function probeTyped(): Promise<void> {
  const generation = ++probeGeneration;
  const typed = pathInput.value.trim();
  if (typed === '') {
    validPath = undefined;
    probeNote.textContent = '';
    installButton.disabled = true;
    return;
  }
  const candidate = await window.desktop.probeGamePath(typed);
  if (generation !== probeGeneration) return; // a newer keystroke's probe is already in flight
  applyCandidate(candidate, false);
}

const logLines: string[] = [];

function pushLog(line: string): void {
  logLines.push(line);
  if (logLines.length > LOG_TAIL_LINES) logLines.shift();
  logTail.textContent = logLines.join('\n');
}

/** A fresh run must not show the previous attempt's bar position or log tail. */
function resetRunPhase(): void {
  logLines.length = 0;
  logTail.textContent = '';
  barFill.style.width = '0%';
  itemCount.textContent = '';
  stageLabel.textContent = 'Starting…';
}

let currentStage: Extract<PipelineEvent, { kind: 'stage' }> | undefined;

function onEvent(event: PipelineEvent): void {
  switch (event.kind) {
    case 'stage': {
      currentStage = event;
      stageLabel.textContent = `${STAGE_LABELS[event.stage]}…`;
      itemCount.textContent = '';
      barFill.style.width = `${overallFraction({ stage: event.stage, done: 0, total: undefined }) * 100}%`;
      return;
    }
    case 'item': {
      if (currentStage === undefined) return;
      const fraction = overallFraction({ stage: currentStage.stage, done: event.done, total: event.total });
      barFill.style.width = `${fraction * 100}%`;
      itemCount.textContent =
        event.total === undefined
          ? `${event.done.toLocaleString('en')} files`
          : `${event.done.toLocaleString('en')} / ${event.total.toLocaleString('en')}`;
      return;
    }
    case 'log': {
      pushLog(event.line);
      return;
    }
    case 'done': {
      barFill.style.width = '100%';
      showPhase('done');
      return;
    }
    case 'error': {
      el('error-message').textContent = 'Installing the game content failed.';
      el('error-log').textContent = [...logLines, event.message].join('\n');
      showPhase('failed');
      return;
    }
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled pipeline event ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Word the pick phase for the content status: first install vs recommended vs required regeneration. */
function applyContentStatus(status: DesktopState['contentStatus']): void {
  if (status === 'missing') return;
  const note = el('status-note');
  const playNow = el<HTMLButtonElement>('play-now');
  note.classList.remove('hidden');
  el('install').textContent = 'Regenerate game content';
  switch (status) {
    case 'ready':
      note.textContent = 'Game content is installed. Regenerate it here if you want a fresh conversion.';
      playNow.classList.remove('hidden');
      return;
    case 'stale-revision':
      // Also the face of an interrupted conversion (no stamp survives one), hence "incomplete".
      note.textContent =
        'Your game content is incomplete or was generated by an older version of Open Northland — regenerating it is recommended.';
      playNow.textContent = 'Play anyway';
      playNow.classList.remove('hidden');
      return;
    case 'stale-schema':
      note.textContent =
        'Your game content was generated by an incompatible older version of Open Northland — it must be regenerated before playing.';
      note.classList.add('blocking');
      return;
    default: {
      const exhaustive: never = status;
      throw new Error(`unhandled content status ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function boot(): Promise<void> {
  const state = await window.desktop.getState();
  el('data-root').textContent = state.dataRoot;
  applyContentStatus(state.contentStatus);
  if (state.gamePath !== undefined) {
    applyCandidate(await window.desktop.probeGamePath(state.gamePath));
  }
  window.desktop.onPipelineEvent(onEvent);

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
    resetRunPhase();
    showPhase('run');
    try {
      await window.desktop.runPipeline(validPath);
    } catch (err) {
      onEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
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
