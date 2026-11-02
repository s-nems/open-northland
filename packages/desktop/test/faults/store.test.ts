import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFaultStore, MAX_STORED_FAULTS, type NewFault } from '../../src/faults/store.js';

const HOME = '/Users/ann';
const CRASH: NewFault = {
  trigger: 'renderer-gone',
  reason: 'crashed',
  exitCode: 11,
  durationMs: null,
  stack: null,
  url: 'app://game/index.html',
  gpuStatus: null,
};
const FAULT_FILE = /^[0-9a-f]{32}\.json$/;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'northland-faults-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A clock one second further on each call. */
function ticking(): () => Date {
  let seconds = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds++));
}

describe('createFaultStore', () => {
  it('lists faults oldest first and drops the oldest beyond the cap', () => {
    const store = createFaultStore(root, HOME, ticking());
    const ids = Array.from(
      { length: MAX_STORED_FAULTS + 1 },
      (_, n) => store.record({ ...CRASH, exitCode: n }).id,
    );
    const pending = store.pending();
    expect(pending.map((fault) => fault.id)).toEqual(ids.slice(1));
    expect(pending[0]).toEqual({ ...CRASH, exitCode: 1, id: ids[1], at: '2026-01-01T00:00:01.000Z' });
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('ignores staged and damaged files and sweeps them on the next record', async () => {
    const store = createFaultStore(root, HOME, ticking());
    const kept = store.record(CRASH);
    const damaged = `${'a'.repeat(32)}.json`;
    const otherVersion = `${'b'.repeat(32)}.json`;
    await writeFile(join(root, `${'c'.repeat(32)}.json.tmp`), '{"version":1');
    await writeFile(join(root, damaged), '{');
    await writeFile(join(root, otherVersion), JSON.stringify({ ...kept, id: 'b'.repeat(32), version: 0 }));
    expect(store.pending()).toEqual([kept]);
    const next = store.record(CRASH);
    expect((await readdir(root)).sort()).toEqual([`${kept.id}.json`, `${next.id}.json`].sort());
  });

  it('fills a recorded fault in place, and a cleared one stays cleared', () => {
    const store = createFaultStore(root, HOME, ticking());
    const hang = store.record({ ...CRASH, trigger: 'renderer-unresponsive', reason: 'unresponsive' });
    store.update(hang.id, { durationMs: 4200, stack: `at loop (${HOME}/game.js:1:2)` });
    expect(store.pending()).toEqual([{ ...hang, durationMs: 4200, stack: 'at loop (~/game.js:1:2)' }]);
    store.clear([hang.id]);
    store.update(hang.id, { durationMs: 9000 });
    expect(store.pending()).toEqual([]);
  });

  it("keeps a GPU process death's feature status", () => {
    const store = createFaultStore(root, HOME, ticking());
    const gpuStatus = {
      webgl: 'unavailable_off',
      webgl2: 'unavailable_off',
      gpu_compositing: 'disabled_software',
    };
    store.record({ ...CRASH, trigger: 'gpu-gone', url: null, gpuStatus });
    expect(store.pending().map((fault) => fault.gpuStatus)).toEqual([gpuStatus]);
  });

  it('clears only well-formed fault ids', async () => {
    const store = createFaultStore(root, HOME, ticking());
    const fault = store.record(CRASH);
    for (const ids of [fault.id, [`../${fault.id}`], [fault.id.toUpperCase()], [1]])
      expect(() => store.clear(ids)).toThrow();
    expect(store.pending()).toEqual([fault]);
  });

  it('writes text clipped to the report limit and without the home directory', async () => {
    const store = createFaultStore(root, HOME, ticking());
    const stack = `Error: boom\n    at ${HOME}/main.cjs:1:1\n${'x'.repeat(20_000)}`;
    store.record({ ...CRASH, trigger: 'error', reason: 'Error', stack });
    const [name] = await readdir(root);
    expect(name).toMatch(FAULT_FILE);
    const written = JSON.parse(await readFile(join(root, name ?? ''), 'utf8')) as { stack: string };
    expect(written.stack.startsWith('Error: boom\n    at ~/main.cjs:1:1\n')).toBe(true);
    expect(written.stack).toHaveLength(16_000);
  });
});
