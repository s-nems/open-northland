import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHILD_DUMP_GRACE_MS, startShellRun } from '../../src/faults/shell-run.js';

const FIRST_START = new Date(Date.UTC(2026, 0, 1));
const SECOND_START = new Date(Date.UTC(2026, 0, 2));
const MINUTE_MS = 60_000;

let root: string;
let runFile: string;
let dumpsRoot: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'northland-run-'));
  runFile = join(root, 'shell-run.json');
  dumpsRoot = join(root, 'Crashpad');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A minidump in Crashpad's report folder, written at `atMs`. */
async function dumpAt(atMs: number): Promise<void> {
  const reports = join(dumpsRoot, 'reports');
  await mkdir(reports, { recursive: true });
  const file = join(reports, `${atMs}.dmp`);
  await writeFile(file, 'MDMP');
  await utimes(file, atMs / 1000, atMs / 1000);
}

const clockAt = (date: Date) => (): Date => date;

describe('startShellRun', () => {
  it('knows no previous run on a first start, and tells a quit with its time', () => {
    const quitAt = new Date(FIRST_START.getTime() + MINUTE_MS);
    let clock = FIRST_START;
    const first = startShellRun(runFile, dumpsRoot, () => clock);
    expect(first.previous).toBeNull();
    clock = quitAt;
    first.quit();
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous).toEqual({
      from: FIRST_START.toISOString(),
      until: SECOND_START.toISOString(),
      end: 'quit',
      endedAt: quitAt.toISOString(),
    });
  });

  it('takes a quit over a dump, a shutdown or a sleep notice before it: the shell outlived them', async () => {
    let clock = FIRST_START;
    const run = startShellRun(runFile, dumpsRoot, () => clock);
    clock = new Date(FIRST_START.getTime() + MINUTE_MS);
    run.shuttingDown();
    run.suspended();
    await dumpAt(clock.getTime() + MINUTE_MS);
    clock = new Date(clock.getTime() + 2 * MINUTE_MS);
    run.quit();
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous?.end).toBe('quit');
  });

  it('tells a shutdown, a crash dump and an end without either apart', async () => {
    const shutdownAt = new Date(FIRST_START.getTime() + MINUTE_MS);
    let clock = FIRST_START;
    const first = startShellRun(runFile, dumpsRoot, () => clock);
    clock = shutdownAt;
    first.shuttingDown();
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous).toEqual({
      from: FIRST_START.toISOString(),
      until: SECOND_START.toISOString(),
      end: 'shutdown',
      endedAt: shutdownAt.toISOString(),
    });

    const crashAt = SECOND_START.getTime() + MINUTE_MS;
    await dumpAt(crashAt);
    expect(startShellRun(runFile, dumpsRoot, clockAt(new Date(crashAt + MINUTE_MS))).previous).toMatchObject({
      end: 'crash',
      endedAt: new Date(crashAt).toISOString(),
    });
    expect(await readdir(join(dumpsRoot, 'reports'))).toEqual([]);

    expect(
      startShellRun(runFile, dumpsRoot, clockAt(new Date(crashAt + 2 * MINUTE_MS))).previous,
    ).toMatchObject({ end: 'unknown', endedAt: null });
  });

  it('takes a dump after a shutdown notice for a crash: the shutdown may have been cancelled', async () => {
    let clock = FIRST_START;
    const run = startShellRun(runFile, dumpsRoot, () => clock);
    clock = new Date(FIRST_START.getTime() + MINUTE_MS);
    run.shuttingDown();
    await dumpAt(clock.getTime() + MINUTE_MS);
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous?.end).toBe('crash');
  });

  it('tells a run that went to sleep and never woke from one that woke and then ended', () => {
    const sleptAt = new Date(FIRST_START.getTime() + MINUTE_MS);
    let clock = FIRST_START;
    const slept = startShellRun(runFile, dumpsRoot, () => clock);
    clock = sleptAt;
    slept.suspended();
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous).toMatchObject({
      end: 'asleep',
      endedAt: sleptAt.toISOString(),
    });

    const woke = startShellRun(runFile, dumpsRoot, () => clock);
    woke.suspended();
    woke.resumed();
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous?.end).toBe('unknown');
  });

  it('takes a dump after a sleep notice for a crash', async () => {
    let clock = FIRST_START;
    const run = startShellRun(runFile, dumpsRoot, () => clock);
    clock = new Date(FIRST_START.getTime() + MINUTE_MS);
    run.suspended();
    await dumpAt(clock.getTime() + MINUTE_MS);
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous?.end).toBe('crash');
  });

  it("does not take a child process's dump for the shell's own crash", async () => {
    let clock = FIRST_START;
    const run = startShellRun(runFile, dumpsRoot, () => clock);
    clock = new Date(FIRST_START.getTime() + MINUTE_MS);
    run.childGone();
    await dumpAt(clock.getTime() + CHILD_DUMP_GRACE_MS / 2);
    expect(startShellRun(runFile, dumpsRoot, clockAt(SECOND_START)).previous?.end).toBe('unknown');
  });
});
