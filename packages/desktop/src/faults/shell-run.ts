import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * How the shell's previous run ended: it quit the ordinary way, the system ended the session, it went
 * to sleep and never woke (the power went while asleep), a native crash left a minidump, or none of
 * these (killed from outside, or the power went while awake).
 */
export type ShellEnd = 'quit' | 'shutdown' | 'asleep' | 'crash' | 'unknown';

/** The shape `packages/app/src/view/platform/desktop-faults.ts` declares as `PreviousShellRun`. */
export interface PreviousShellRun {
  /** ISO times: the previous run's start and this run's, which bound the pages it served. */
  readonly from: string;
  readonly until: string;
  readonly end: ShellEnd;
  /** When the shell quit, the session ended, the system went to sleep or the dump was written; null
   *  for `unknown`. */
  readonly endedAt: string | null;
}

export interface ShellRun {
  /** The previous run; null on a first start or when its file could not be read. */
  readonly previous: PreviousShellRun | null;
  /** A renderer, GPU or utility process died: the dump it leaves is not the shell's own crash. */
  childGone(): void;
  /** The system is ending the session: the end that follows is no crash. */
  shuttingDown(): void;
  /** The system goes to sleep: an end before it wakes is a power loss, no crash. */
  suspended(): void;
  resumed(): void;
  /** The shell quits the ordinary way, after its windows closed. */
  quit(): void;
}

/** Under Electron's `userData`. */
export const SHELL_RUN_FILE = 'shell-run.json';
const RUN_FILE_VERSION = 3;
const DUMP_SUFFIX = '.dmp';
const STAGED_SUFFIX = '.tmp';
/** A child process's dump is written a moment after the shell hears it died. */
export const CHILD_DUMP_GRACE_MS = 10_000;

interface RunFile {
  readonly startedAt: string;
  readonly childGoneAt: string | null;
  readonly shutdownAt: string | null;
  readonly suspendedAt: string | null;
  readonly quitAt: string | null;
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function readRun(file: string): RunFile | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const fields = raw as Record<string, unknown>;
    const { version, startedAt, childGoneAt, shutdownAt, suspendedAt, quitAt } = fields;
    if (version !== RUN_FILE_VERSION || !isTime(startedAt)) return null;
    if (childGoneAt !== null && !isTime(childGoneAt)) return null;
    if (shutdownAt !== null && !isTime(shutdownAt)) return null;
    if (suspendedAt !== null && !isTime(suspendedAt)) return null;
    if (quitAt !== null && !isTime(quitAt)) return null;
    return { startedAt, childGoneAt, shutdownAt, suspendedAt, quitAt };
  } catch {
    return null;
  }
}

/** Every minidump under `root` with its write time in epoch milliseconds. */
function dumps(root: string): { readonly path: string; readonly atMs: number }[] {
  let names: string[];
  try {
    names = readdirSync(root, { recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!name.endsWith(DUMP_SUFFIX)) return [];
    const path = join(root, name);
    try {
      return [{ path, atMs: statSync(path).mtimeMs }];
    } catch {
      return [];
    }
  });
}

/** A quit wins over everything: the shell reached it alive, after its windows closed. A dump wins
 *  over a shutdown or sleep notice: a shutdown another app cancelled leaves the shell running. A
 *  shutdown wins over sleep: the system may end a sleeping session. */
function endOf(run: RunFile, dumpsRoot: string): Pick<PreviousShellRun, 'end' | 'endedAt'> {
  if (run.quitAt !== null) return { end: 'quit', endedAt: run.quitAt };
  const childDumpsUntil =
    run.childGoneAt === null ? Number.NEGATIVE_INFINITY : Date.parse(run.childGoneAt) + CHILD_DUMP_GRACE_MS;
  const after = Math.max(Date.parse(run.startedAt), childDumpsUntil);
  const newest = Math.max(...dumps(dumpsRoot).map((dump) => dump.atMs));
  if (newest > after) return { end: 'crash', endedAt: new Date(newest).toISOString() };
  if (run.shutdownAt !== null) return { end: 'shutdown', endedAt: run.shutdownAt };
  if (run.suspendedAt !== null) return { end: 'asleep', endedAt: run.suspendedAt };
  return { end: 'unknown', endedAt: null };
}

/**
 * The shell's run file: written at start, rewritten when a child process dies, the system ends the
 * session, sleeps or wakes, and when the shell quits. One without its quit at the next start is a run
 * that ended without quitting.
 * Dumps are only evidence of a crash, never sent anywhere, so the start deletes them once judged.
 * Synchronous, because the system may end the process right after `shuttingDown` or `suspended`.
 */
export function startShellRun(file: string, dumpsRoot: string, now: () => Date = () => new Date()): ShellRun {
  const left = readRun(file);
  const startedAt = now().toISOString();
  const previous =
    left === null ? null : { from: left.startedAt, until: startedAt, ...endOf(left, dumpsRoot) };
  for (const dump of dumps(dumpsRoot)) {
    try {
      rmSync(dump.path, { force: true });
    } catch {
      // A dump the crash handler still holds goes at a later start.
    }
  }

  let run: RunFile = { startedAt, childGoneAt: null, shutdownAt: null, suspendedAt: null, quitAt: null };
  const write = (): void => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const staged = `${file}${STAGED_SUFFIX}`;
      writeFileSync(staged, JSON.stringify({ version: RUN_FILE_VERSION, ...run }));
      renameSync(staged, file);
    } catch (failure) {
      console.error('Could not write the shell run file:', failure);
    }
  };
  write();
  return {
    previous,
    childGone() {
      run = { ...run, childGoneAt: now().toISOString() };
      write();
    },
    shuttingDown() {
      run = { ...run, shutdownAt: now().toISOString() };
      write();
    },
    suspended() {
      run = { ...run, suspendedAt: now().toISOString() };
      write();
    },
    resumed() {
      run = { ...run, suspendedAt: null };
      write();
    },
    quit() {
      run = { ...run, quitAt: now().toISOString() };
      write();
    },
  };
}
