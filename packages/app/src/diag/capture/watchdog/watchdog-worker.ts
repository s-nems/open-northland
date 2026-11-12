import { randomReportId } from '../report-id.js';
import { MARKER_BEAT_MS } from '../unclean-exit.js';
import { deleteFreezeRecords, type FreezeRecord, putFreezeRecord } from './freeze-records.js';
import { FREEZE_REPORT_MS, FreezeWatch, WATCHDOG_BEAT_MS } from './freeze-watch.js';
import type { Thaw, ToWatchdog } from './protocol.js';

// A dedicated worker's global scope; the DOM typings the app compiles against describe a window.
const scope = globalThis as unknown as {
  postMessage(message: Thaw): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWatchdog>) => void): void;
};

/** How often the record of a lasting freeze is rewritten, so another tab's start-up sees it is ours. */
const RECORD_REFRESH_MS = MARKER_BEAT_MS;

let tabId: string | null = null;
/** The record of the freeze under way, written once it passed the threshold. */
let record: { readonly stored: FreezeRecord; written: Promise<void> } | null = null;

function refresh(): void {
  if (record === null || Date.now() - record.stored.seenAt < RECORD_REFRESH_MS) return;
  const stored = { ...record.stored, seenAt: Date.now() };
  const previous = record.written;
  record = { stored, written: previous.then(() => putFreezeRecord(stored)).catch(() => undefined) };
}

const watch = new FreezeWatch(
  {
    frozen: (silentMs, context) => {
      if (tabId === null || context === null) return;
      const id = randomReportId();
      const nowMs = Date.now();
      const stored: FreezeRecord = { id, tabId, frozenAt: nowMs - silentMs, seenAt: nowMs, context };
      // A failed write loses only the report of a page that never comes back.
      record = { stored, written: putFreezeRecord(stored).catch(() => undefined) };
    },
    thawed: (freezeMs, context, afterWake) => {
      scope.postMessage({ kind: 'thawed', freezeMs, frozenAt: Date.now() - freezeMs, context, afterWake });
      const ended = record;
      record = null;
      if (ended !== null)
        void ended.written.then(() => deleteFreezeRecords([ended.stored.id])).catch(() => undefined);
    },
  },
  FREEZE_REPORT_MS,
  WATCHDOG_BEAT_MS,
  performance.now(),
);

scope.addEventListener('message', ({ data }) => {
  if (data.kind === 'beat') watch.beat(performance.now(), data.visible, data.context);
  else if (tabId === null) {
    tabId = data.tabId;
    setInterval(() => {
      watch.check(performance.now());
      refresh();
    }, WATCHDOG_BEAT_MS);
  }
});
