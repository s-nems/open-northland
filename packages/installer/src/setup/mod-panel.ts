import { formatMessage, localeTag, messages } from '../i18n/index.js';
import type { ModDelivery, ModEvent, ModInstallApi } from '../shell-api.js';
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

export function createModPanel(
  api: ModInstallApi,
  onModRoot: (root: string) => void,
  delivery: () => ModDelivery,
): ModPanelView {
  const panel = el('mod-panel');
  const progress = el('mod-progress');
  const note = el('mod-note');

  const fallbackNote = (): string =>
    delivery() === 'origin-archive'
      ? messages().setup.mod.fallbackArchive
      : messages().setup.mod.fallbackFolder;

  /** Either button runs the same long install, so both are held for its whole duration. */
  function setBusy(busy: boolean): void {
    progress.classList.toggle('hidden', !busy);
    el<HTMLButtonElement>('mod-download').disabled = busy;
    el<HTMLButtonElement>('mod-pick').disabled = busy;
  }

  async function install(run: () => Promise<string | null>): Promise<void> {
    const copy = messages().setup.mod;
    setBusy(true);
    note.textContent = '';
    try {
      const root = await run();
      if (root !== null) onModRoot(root);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A user Cancel surfaces as an AbortError riding the IPC rejection, not as a failure.
      note.textContent = /abort/i.test(message)
        ? copy.cancelled
        : formatMessage(copy.downloadFailed, { message, fallback: fallbackNote() });
    } finally {
      setBusy(false);
    }
  }

  el('mod-download').addEventListener('click', () => void install(() => api.downloadMod()));
  el('mod-cancel').addEventListener('click', () => void api.cancelModDownload());
  el('mod-pick').addEventListener('click', () => void install(() => api.pickModFolder()));

  return {
    handleEvent: renderModEvent,
    setVisible(visible: boolean): void {
      panel.classList.toggle('hidden', !visible);
    },
    applyLabels(): void {
      const copy = messages().setup.mod;
      el('mod-required-note').innerHTML =
        delivery() === 'origin-archive' ? copy.requiredOriginHtml : copy.requiredUpstreamHtml;
      el('mod-download').textContent = copy.download;
      el('mod-pick').textContent = copy.haveIt;
      el('mod-cancel').textContent = messages().setup.cancel;
    },
  };
}
