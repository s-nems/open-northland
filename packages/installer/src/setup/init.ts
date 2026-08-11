import { currentLocale, formatMessage, type Locale, messages, setActiveLocale } from '../i18n/index.js';
import type { ShellApi } from '../shell-api.js';
import { showSetupBlocked } from './blocked.js';
import { el } from './dom.js';
import { createLangSwitch } from './lang-switch.js';
import { showPhase } from './phases.js';
import { createPickPanel } from './pick-panel.js';
import { createPipelineProgress } from './pipeline-progress.js';

export { showSetupBlocked } from './blocked.js';

/** Boots the shared setup page against the hosting shell's {@link ShellApi}. */
export function initSetup(api: ShellApi): void {
  const progress = createPipelineProgress(showPhase);
  const langSwitch = createLangSwitch((locale) => void applyLocale(locale));
  const pick = createPickPanel(api, {
    onInstall: (gamePath) => void runPipeline(gamePath),
    onPlay: () => void api.startGame(),
  });

  /** Remembered so a language switch can re-render the page without re-fetching the shell state. */
  let dataRootLabel: string | undefined;

  async function runPipeline(gamePath: string): Promise<void> {
    progress.reset();
    showPhase('run');
    try {
      await api.runPipeline(gamePath);
    } catch (err) {
      progress.handleEvent({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function applyLocale(locale: Locale): Promise<void> {
    if (currentLocale() === locale) return;
    await api.setLocale(locale);
    setActiveLocale(locale);
    renderAll();
  }

  function renderAll(): void {
    const t = messages().setup;
    document.title = t.title;
    el('intro').innerHTML = t.introHtml;
    el('cancel').textContent = t.cancel;
    el('done-ok').textContent = t.installed;
    el('play').textContent = t.play;
    el('retry').textContent = t.back;
    el('legal').innerHTML = t.legalHtml;
    // legalHtml just recreated an empty #data-root
    el('data-root').textContent = dataRootLabel ?? t.browserStorage;
    pick.applyLabels();
    progress.relabel();
    langSwitch.applyLabels();
  }

  /**
   * A conversion clears the content tree before it writes, so the status the pick panel is holding
   * is wrong the moment a run starts. Anything that returns to that panel re-reads it first, or the
   * page would keep offering Play for content that is no longer there.
   */
  async function refreshState(): Promise<void> {
    const state = await api.getState();
    dataRootLabel = state.dataRootLabel;
    pick.applyState(state);
    renderAll();
  }

  async function boot(): Promise<void> {
    const state = await api.getState();
    setActiveLocale(state.locale);
    dataRootLabel = state.dataRootLabel;
    pick.applyState(state);
    renderAll();

    api.onPipelineEvent((event) => {
      progress.handleEvent(event);
      if (event.kind === 'done' || event.kind === 'error') void refreshState();
    });
    api.onModEvent((event) => pick.handleModEvent(event));

    el('cancel').addEventListener('click', async () => {
      // Awaited so a late error event cannot flip the page to the failed phase.
      await api.stopPipeline();
      await refreshState();
      showPhase('pick');
    });
    el('play').addEventListener('click', () => void api.startGame());
    el('retry').addEventListener('click', async () => {
      await refreshState();
      showPhase('pick');
    });

    await pick.start(state.gamePath);
  }

  void boot().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    showSetupBlocked(formatMessage(messages().errors.setupFailed, { message }));
  });
}
