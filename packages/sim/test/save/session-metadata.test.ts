import { describe, expect, it } from 'vitest';
import { exportSaveGame, parseSaveGame, Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

function sim() {
  return new Simulation({ seed: 1, content: testContent() });
}
describe('opaque saved session metadata', () => {
  it('copies caller metadata on export and parse without changing simulated state', () => {
    const world = sim(),
      before = world.hashState(),
      metadata = { version: 1, roster: [{ player: 0, nick: 'Ania' }] };
    const save = exportSaveGame(world, { session: metadata });
    const first = metadata.roster[0];
    if (first === undefined) throw new Error('missing test seat');
    first.nick = 'Changed';
    expect(save.header.session).toEqual({ version: 1, roster: [{ player: 0, nick: 'Ania' }] });
    const parsed = parseSaveGame(save);
    expect(parsed.header.session).toEqual(save.header.session);
    expect(parsed.header.session).not.toBe(save.header.session);
    expect(world.hashState()).toBe(before);
  });
  it('rejects old format metadata and a missing current field', () => {
    const save = exportSaveGame(sim());
    const header = { ...save.header, formatVersion: 3, session: { untrusted: 'legacy extra' } };
    expect(() => parseSaveGame({ ...save, header })).toThrow('unsupported version 3');
    expect(() => parseSaveGame({ ...save, header: { ...save.header, session: undefined } })).toThrow(
      'plain JSON',
    );
  });
  it('rejects lossy, cyclic and oversized metadata', () => {
    const world = sim(),
      cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const session of [
      cycle,
      { v: undefined },
      { v: NaN },
      { v: new Date() },
      new Array(5000).fill(null),
      'x'.repeat(65537),
    ]) {
      expect(() => exportSaveGame(world, { session })).toThrow(/session/);
    }
  });
});
