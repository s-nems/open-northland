import { formatMessage, localeTag, messages } from '../i18n/index.js';
import type { ModEvent } from '../ipc.js';
import { el } from './dom.js';

/** Whole megabytes; the caller appends the unit. */
const mb = (bytes: number): string => `${Math.round(bytes / 1e6)}`;

export interface ModPanelView {
  handleEvent(event: ModEvent): void;
  setVisible(visible: boolean): void;
  applyLabels(): void;
}

function renderModEvent(event: ModEvent): void {
  const copy = messages().setup.mod;
  const fill = el('mod-bar-fill');
  switch (event.kind) {
    case 'mod-download': {
      el('mod-stage').textContent = copy.downloading;
      if (event.total !== undefined) {
        fill.style.width = `${(event.received / event.total) * 100}%`;
        el('mod-count').textContent = `${mb(event.received)} / ${mb(event.total)} MB`;
      } else {
        el('mod-count').textContent = `${mb(event.received)} MB`;
      }
      return;
    }
    case 'mod-extract': {
      const tag = localeTag();
      el('mod-stage').textContent = copy.unpacking;
      fill.style.width = `${(event.done / event.total) * 100}%`;
      el('mod-count').textContent = `${event.done.toLocaleString(tag)} / ${event.total.toLocaleString(tag)}`;
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

export function createModPanel(onModRoot: (root: string) => void): ModPanelView {
  const panel = el('mod-panel');
  const progress = el('mod-progress');
  const note = el('mod-note');
  el('mod-download').addEventListener('click', async () => {
    const copy = messages().setup.mod;
    progress.classList.remove('hidden');
    note.textContent = '';
    el<HTMLButtonElement>('mod-download').disabled = true;
    try {
      onModRoot(await window.desktop.downloadMod());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A user Cancel surfaces as an AbortError riding the IPC rejection, not as a failure.
      note.textContent = /abort/i.test(message)
        ? copy.cancelled
        : formatMessage(copy.downloadFailed, { message, fallback: copy.fallbackNote });
    } finally {
      progress.classList.add('hidden');
      el<HTMLButtonElement>('mod-download').disabled = false;
    }
  });
  el('mod-cancel').addEventListener('click', () => void window.desktop.cancelModDownload());
  el('mod-pick').addEventListener('click', async () => {
    const copy = messages().setup.mod;
    try {
      const picked = await window.desktop.pickModFolder();
      if (picked === null) return;
      note.textContent = '';
      onModRoot(picked);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      note.textContent = formatMessage(copy.pickFailed, { message, fallback: copy.fallbackNote });
    }
  });

  return {
    handleEvent: renderModEvent,
    setVisible(visible: boolean): void {
      panel.classList.toggle('hidden', !visible);
    },
    applyLabels(): void {
      const copy = messages().setup.mod;
      // Trusted developer markup; never interpolates user input.
      el('mod-required-note').innerHTML = copy.requiredHtml;
      el('mod-download').textContent = copy.download;
      el('mod-pick').textContent = copy.haveIt;
      el('mod-cancel').textContent = messages().setup.cancel;
    },
  };
}
