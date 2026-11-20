/**
 * The bug report flow: takes every `Problem`, sends its light report when the player allows it and
 * the session's limits do, keeps one dialog on screen, and retries what the outbox holds.
 */
import type { ReportError } from '@open-northland/data';
import { API_PARAM, apiBaseUrl, automationWithoutServer } from '../../content/map-source/api.js';
import { reloadDocument } from '../../view/platform/navigation-guard.js';
import { readStoredSettings } from '../../view/settings/store.js';
import { serializeDiagnosticsBundle } from '../bundle.js';
import { downloadJsonFile } from '../download.js';
import { diag } from '../log.js';
import {
  type AttachmentOffers,
  captureScreenshot,
  gatherOffers,
  newestAutosave,
  reportSettings,
} from './attachments.js';
import { buildReportDraft } from './build.js';
import {
  type AttachmentKind,
  type CaseDeps,
  type PlayerInput,
  ReportCase,
  shownNumber,
  uploadList,
} from './case.js';
import { browserUploadLocks, Courier } from './courier.js';
import { openReportDialog, type ReportDialog } from './dialog.js';
import { problemKeys } from './fingerprint.js';
import { ProblemGate } from './gate.js';
import { gzipSize } from './gzip.js';
import { browserOutbox, memoryOutbox, outboxWithFallback } from './outbox.js';
import { type Problem, setProblemSink } from './problem.js';
import { postReport } from './send.js';

/** The outbox waits for the page to settle after a start before it tries again. */
const STARTUP_FLUSH_DELAY_MS = 5000;

interface OpenDialog {
  readonly dialog: ReportDialog;
  readonly kase: ReportCase;
  /** Problems that came while it was open. */
  more: number;
  /** Reports of those, built and waiting for the player's Send while automatic sending is off. */
  readonly held: ReportCase[];
}

let open: OpenDialog | null = null;
const problemGate = new ProblemGate();
/** The cases with an upload in the outbox, by report id, so a later try can update their dialog. */
const cases = new Map<string, ReportCase>();
/** The case each error was reported in, by its name and message, which every thread reports alike. */
const casesByError = new Map<string, ReportCase>();

const courier = new Courier({
  store: outboxWithFallback(browserOutbox(), memoryOutbox()),
  locks: browserUploadLocks(),
  post: (entry) => postReport(entry.body, entry.part, entry.id),
  now: () => Date.now(),
  settled: (entry, result, dropped) => {
    cases.get(entry.id)?.settled(entry.part, result, dropped);
    if (dropped && (entry.part === 'addendum' || result.kind !== 'sent')) cases.delete(entry.id);
  },
});

/** Whatever breaks under automation reaches the live report server only when `?api=` names one. */
export function automationWithoutApi(
  search: string = window.location.search,
  webdriver: boolean = navigator.webdriver,
): boolean {
  return automationWithoutServer(API_PARAM, search, webdriver);
}

function automaticSending(): boolean {
  return readStoredSettings().autoErrorReports && !automationWithoutApi();
}

function depsFor(kase: ReportCase): CaseDeps {
  // Keyed by the entry, whose id is the report's current one after a refile.
  return {
    deliver: (entry) => {
      cases.set(entry.id, kase);
      return courier.deliver(entry);
    },
    queue: (entry) => {
      cases.set(entry.id, kase);
      return courier.queue(entry);
    },
    now: () => Date.now(),
  };
}

const errorKey = (error: ReportError): string => `${error.name}\n${error.message}`;

async function prepareCase(
  kase: ReportCase,
  problem: Problem | null,
  offers: () => Promise<AttachmentOffers>,
): Promise<void> {
  const [draft, gathered] = await Promise.all([buildReportDraft(problem), offers()]);
  await kase.prepare(draft, gathered);
}

/** Only the dialog's own report offers the player's files; a further problem carries its facts. */
async function settingsOnly(): Promise<AttachmentOffers> {
  const value = reportSettings();
  return { settings: { value, bytes: await gzipSize(value) }, screenshot: null, save: null };
}

async function problemOffers(): Promise<AttachmentOffers> {
  const [base, screenshot, save] = await Promise.all([settingsOnly(), captureScreenshot(), newestAutosave()]);
  return { ...base, screenshot, save };
}

/** The download: this page's diagnostics with the report's uploads, sent, queued or still to send. */
async function downloadReport(kase: ReportCase, input: PlayerInput): Promise<void> {
  const draft = kase.draft;
  if (draft === null) return;
  // Before Send, what Send would add; after it, only what went out or waits to.
  const pending = kase.submitted ? [] : uploadList(await kase.compose(input));
  const report = [...kase.handedOver, ...pending];
  const bundle = { ...draft.bundle, report };
  downloadJsonFile(
    `opennorthland-report-${shownNumber(draft.report.id)}.json`,
    serializeDiagnosticsBundle(bundle),
  );
}

interface DialogState {
  /** "Send error reports automatically" when the problem came. */
  readonly automatic: boolean;
  /** Automatic sending is on, but the session's limits held this report back. */
  readonly limited: boolean;
  readonly fatal: boolean;
}

/** Start `send`, and run `then` once its report is answered or queued, or the send ended without. */
export function afterReportAnswered(
  kase: Pick<ReportCase, 'onChange' | 'reportAnswered' | 'needsWords'>,
  send: () => Promise<void>,
  then: () => Promise<void>,
): void {
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    stopWatching();
    void then();
  };
  // A report the server only counted is answered again by the new report this Send files for it.
  const awaitsPost = !kase.reportAnswered() || kase.needsWords();
  let posted = false;
  const stopWatching = kase.onChange(() => {
    if (!kase.reportAnswered()) posted = true;
    else if (!awaitsPost || posted) start();
  });
  void send().finally(start);
  if (!awaitsPost) start();
}

function showDialog(kase: ReportCase, problem: Problem | null, state: DialogState): void {
  // Read once the draft is in, when the dialog first offers the part.
  const defaults = (kind: AttachmentKind): boolean => {
    // The player who opens the form in a game shows what they see; a problem asks first.
    if (kind === 'screenshot') return problem === null;
    // About a megabyte: worth it only when the command log alone cannot replay a restored session.
    if (kind === 'save') return kase.draft?.report.game?.restoredAtTick !== undefined;
    return true;
  };
  const held: ReportCase[] = [];
  const dialog = openReportDialog(
    {
      kase,
      trigger: problem?.trigger ?? 'manual',
      previousSession: problem?.earlier?.previousSession === true,
      ...state,
      defaults,
      onReload: reloadDocument,
      onSend: (input, alsoHeld) => {
        const others = alsoHeld ? held.splice(0) : [];
        // The player's own report goes first, so the held ones do not spend the server's limits before
        // it. Its addendum may take minutes on a slow link: they start as soon as the report is
        // answered, and so reach the outbox before a reload could lose them.
        afterReportAnswered(
          kase,
          () => kase.sendFromPlayer(input),
          async () => {
            for (const other of others) await other.sendAutomatically();
          },
        );
      },
      onDownload: (input) => void downloadReport(kase, input),
      onClose: () => {
        if (open?.kase === kase) open = null;
      },
    },
    apiBaseUrl(),
  );
  open = { dialog, kase, more: 0, held };
}

function onProblem(problem: Problem): void {
  const { key } = problemKeys(problem.trigger, problem.error);
  const automatic = automaticSending();
  const gate = problemGate.decide(problem, key, automatic, open !== null);
  diag.info('report', `problem: ${problem.trigger}`, { key, ...gate });
  if (open !== null) {
    open.more++;
    open.dialog.setMore(open.more);
    if (gate.show === 'stopped') open.dialog.stopped();
  }
  // A repeat nobody sends, holds or shows costs no world hash and no gzip.
  if (gate.show !== 'dialog' && !gate.send && !gate.hold) return;
  // An error reported already shows in the case it was reported in, so Send adds to that report.
  const reportedIn =
    problem.reported === true && problem.error !== undefined
      ? casesByError.get(errorKey(problem.error))
      : undefined;
  if (reportedIn !== undefined) {
    if (gate.show === 'dialog')
      showDialog(reportedIn, problem, { automatic, limited: false, fatal: problem.fatal === true });
    return;
  }
  const kase = new ReportCase(depsFor, false);
  if (problem.error !== undefined && problem.reported !== true)
    casesByError.set(errorKey(problem.error), kase);
  // The screen and the saves of this page say nothing about a problem an earlier page saw.
  const offers = gate.show === 'dialog' && problem.earlier === undefined ? problemOffers : settingsOnly;
  const prepared = prepareCase(kase, problem, offers);
  prepared.then(
    () => (gate.send ? kase.sendAutomatically() : undefined),
    (error: unknown) => diag.error('report', 'building a report failed', error),
  );
  if (gate.hold && open !== null) {
    const holder = open;
    prepared.then(
      () => {
        if (open !== holder) return;
        holder.held.push(kase);
        holder.dialog.setHeld(holder.held);
      },
      () => undefined,
    );
  }
  if (gate.show === 'dialog') {
    showDialog(kase, problem, {
      automatic,
      limited: automatic && !gate.send && problem.reported !== true,
      fatal: problem.fatal === true,
    });
  }
}

/** The player's own report, from the credits screen or the game menu. */
export function openBugReportForm(): void {
  if (open !== null) {
    open.dialog.focus();
    return;
  }
  const kase = new ReportCase(depsFor, true);
  void prepareCase(kase, null, gatherOffers).catch((error: unknown) =>
    diag.error('report', 'building a report failed', error),
  );
  showDialog(kase, null, { automatic: false, limited: false, fatal: false });
}

let installed = false;

/** Take problems from now on, and send what an earlier page left in the outbox. */
export function installBugReports(): void {
  if (installed) return;
  installed = true;
  setProblemSink(onProblem);
  // The link may work again: a lost link's backoff no longer holds, a server's Retry-After does.
  window.addEventListener('online', () => void courier.flush({ linkBack: true }));
  setTimeout(() => void courier.flush({ linkBack: true }), STARTUP_FLUSH_DELAY_MS);
}
