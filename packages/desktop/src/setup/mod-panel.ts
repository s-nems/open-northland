import type { ModEvent } from '../ipc.js';
import { el } from './dom.js';

/**
 * The wizard's mod step. The culturesnation mod is required, so a game folder without `DataCnmd/`
 * gets this panel: download it into the data root, or point at a copy the user unpacked themselves.
 * Either way it reports the resolved mod root back to the page, which re-words the pick phase.
 */

/** MB with no decimals — download progress copy ("312 / 594 MB"). */
const mb = (bytes: number): string => `${Math.round(bytes / 1e6)}`;

/** The manual fallback shown when the download fails or the user prefers their own copy. */
const MOD_FALLBACK_NOTE =
  'You can download the mod yourself from culturesnation.pl (news page → CnMod), unpack the zip, ' +
  'and point "I already have it…" at the unpacked folder.';

/** Render one download/extract progress event from the installer. */
export function renderModEvent(event: ModEvent): void {
  const fill = el('mod-bar-fill');
  switch (event.kind) {
    case 'mod-download': {
      el('mod-stage').textContent = 'Downloading the mod…';
      if (event.total !== undefined) {
        fill.style.width = `${(event.received / event.total) * 100}%`;
        el('mod-count').textContent = `${mb(event.received)} / ${mb(event.total)} MB`;
      } else {
        el('mod-count').textContent = `${mb(event.received)} MB`;
      }
      return;
    }
    case 'mod-extract': {
      el('mod-stage').textContent = 'Unpacking…';
      fill.style.width = `${(event.done / event.total) * 100}%`;
      el('mod-count').textContent =
        `${event.done.toLocaleString('en')} / ${event.total.toLocaleString('en')}`;
      return;
    }
    case 'mod-warning': {
      el('mod-note').textContent = event.message;
      return;
    }
    default: {
      const exhaustive: never = event;
      throw new Error(`unhandled mod event ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Wire the panel's buttons; `onModRoot` fires with the mod root each time one becomes available. */
export function wireModPanel(onModRoot: (root: string) => void): void {
  const progress = el('mod-progress');
  const note = el('mod-note');
  el('mod-download').addEventListener('click', async () => {
    progress.classList.remove('hidden');
    note.textContent = '';
    el<HTMLButtonElement>('mod-download').disabled = true;
    try {
      onModRoot(await window.desktop.downloadMod());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A user-initiated Cancel surfaces as an AbortError riding the IPC rejection — that is not a
      // failure and gets no fallback lecture.
      note.textContent = /abort/i.test(message)
        ? 'Download cancelled.'
        : `Downloading the mod failed: ${message} — ${MOD_FALLBACK_NOTE}`;
    } finally {
      progress.classList.add('hidden');
      el<HTMLButtonElement>('mod-download').disabled = false;
    }
  });
  el('mod-cancel').addEventListener('click', () => void window.desktop.cancelModDownload());
  el('mod-pick').addEventListener('click', async () => {
    try {
      const picked = await window.desktop.pickModFolder();
      if (picked === null) return;
      note.textContent = '';
      onModRoot(picked);
    } catch (err) {
      note.textContent = `${err instanceof Error ? err.message : String(err)} — ${MOD_FALLBACK_NOTE}`;
    }
  });
}
