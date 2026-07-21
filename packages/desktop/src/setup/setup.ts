import { currentLocale, type Locale, messages, setActiveLocale } from '../i18n/index.js';
import type { DesktopApi } from '../ipc.js';
import { el } from './dom.js';
import { createLangSwitch } from './lang-switch.js';
import { createPickPanel } from './pick-panel.js';
import { createPipelineProgress } from './pipeline-progress.js';

/**
 * The first-run installer page: it composes the wizard's phases (pick → run → done | failed), owns
 * the switch between them, and re-renders every locale-dependent string when the language changes.
 * Each phase owns its own DOM and state; all game-folder knowledge lives behind `window.desktop`
 * ({@link DesktopApi}).
 */

declare global {
  interface Window {
    readonly desktop: DesktopApi;
  }
}

const phases = { pick: el('pick'), run: el('run'), done: el('done'), failed: el('failed') } as const;

function showPhase(name: keyof typeof phases): void {
  for (const [key, section] of Object.entries(phases)) {
    section.classList.toggle('hidden', key !== name);
  }
}

const progress = createPipelineProgress(showPhase);
const langSwitch = createLangSwitch((locale) => void applyLocale(locale));
const pick = createPickPanel({
  onInstall: (gamePath) => void runPipeline(gamePath),
  onPlay: () => void window.desktop.startGame(),
});

/** Remembered so a language switch can re-render the page without re-fetching the shell state. */
let dataRootPath = '';

async function runPipeline(gamePath: string): Promise<void> {
  progress.reset();
  showPhase('run');
  try {
    await window.desktop.runPipeline(gamePath);
  } catch (err) {
    progress.handleEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

async function applyLocale(locale: Locale): Promise<void> {
  if (currentLocale() === locale) return;
  await window.desktop.setLocale(locale); // persist + re-localize the native menu
  setActiveLocale(locale);
  renderAll();
}

/** Re-render every locale-dependent string from the current active locale + remembered state. */
function renderAll(): void {
  const t = messages().setup;
  document.title = t.title;
  // The `*Html` entries are trusted developer markup, never user input.
  el('intro').innerHTML = t.introHtml;
  el('cancel').textContent = t.cancel;
  el('done-ok').textContent = t.installed;
  el('play').textContent = t.play;
  el('retry').textContent = t.back;
  el('legal').innerHTML = t.legalHtml;
  el('data-root').textContent = dataRootPath; // legalHtml just recreated an empty #data-root
  pick.applyLabels();
  progress.relabel(); // the run/failed phase's live stage or failure line owns its own text
  langSwitch.applyLabels();
}

async function boot(): Promise<void> {
  const state = await window.desktop.getState();
  setActiveLocale(state.locale);
  dataRootPath = state.dataRoot;
  pick.applyState(state);
  renderAll();

  window.desktop.onPipelineEvent((event) => progress.handleEvent(event));
  window.desktop.onModEvent((event) => pick.handleModEvent(event));

  el('cancel').addEventListener('click', async () => {
    // stop() silences the run's events, so no late error flips the page to the failed phase.
    await window.desktop.stopPipeline();
    showPhase('pick');
  });
  el('play').addEventListener('click', () => void window.desktop.startGame());
  el('retry').addEventListener('click', () => showPhase('pick'));

  await pick.start(state.gamePath);
}

void boot();
