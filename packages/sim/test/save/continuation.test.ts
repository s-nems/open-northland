import { describe, expect, it } from 'vitest';
import {
  adminCommand,
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type SavedCommand,
  Simulation,
  serializeSaveGame,
  withSaveContinuation,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

const input = (applyTick: number, enabled: boolean): SavedCommand => ({
  applyTick,
  envelope: adminCommand({ kind: 'setNeedsEnabled', enabled }),
});
const create = () => new Simulation({ seed: 7, content: testContent() });
const restore = (sim: Simulation) =>
  restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
    content: testContent(),
  }).sim;

describe('saved accepted command continuation', () => {
  it('applies endogenous, inherited, then fresh input without transport sequence collisions', () => {
    const sim = create();
    sim.enqueue(adminCommand({ kind: 'setNeedsEnabled', enabled: true }));
    const saved = exportSaveGame(sim, { continuation: [input(1, false)] });
    const copy = restoreSimulation(saved, { content: testContent() }).sim;
    copy.commands.enqueueAt(input(1, true).envelope, 1, 0);
    sim.commands.enqueueAt(input(1, false).envelope, 1, 0);
    sim.commands.enqueueAt(input(1, true).envelope, 1, 1);
    sim.step();
    copy.step();
    expect(copy.hashState()).toBe(sim.hashState());
    expect(copy.events.current()).toEqual(sim.events.current());
    expect(copy.commands.log).toEqual(sim.commands.log);
    expect(copy.commands.log.map(({ command }) => command)).toEqual([
      input(1, true).envelope.command,
      input(1, false).envelope.command,
      input(1, true).envelope.command,
    ]);
    expect(copy.commands.continuationSnapshot()).toEqual([]);
  });

  it('retains future input through repeated saves, executes once, and merges old before new', () => {
    const sim = create();
    const saved = exportSaveGame(sim, { continuation: [input(3, false), input(5, true)] });
    const merged = withSaveContinuation(saved, [input(3, true)]);
    expect(saved.sections.find((s) => s.id === 'commands')?.continuation).toHaveLength(2);
    let copy = restoreSimulation(merged, { content: testContent() }).sim;
    copy.step();
    copy = restore(copy);
    copy.step();
    copy = restore(copy);
    copy.step();
    expect(copy.commands.log.map(({ command }) => command)).toEqual([
      input(3, false).envelope.command,
      input(3, true).envelope.command,
    ]);
    copy = restore(copy);
    copy.run(3);
    expect(copy.commands.log.map(({ command }) => command)).toEqual([input(5, true).envelope.command]);
    expect(copy.commands.continuationSnapshot()).toEqual([]);
  });

  it('keeps a synchronous capture at its original tick while the live world advances', () => {
    const sim = create();
    const captured = exportSaveGame(sim);
    sim.run(5);
    const completed = withSaveContinuation(captured, [input(2, false)]);
    expect(completed.header.tick).toBe(0);
    const copy = restoreSimulation(completed, { content: testContent() }).sim;
    copy.run(2);
    expect(copy.commands.log).toHaveLength(1);
    expect(copy.commands.log[0]?.applyTick).toBe(2);
  });

  it('owns snapshots, excludes live transport frames, and discards inherited input for replay', () => {
    const supplied = input(3, false);
    const saved = exportSaveGame(create(), { continuation: [supplied] });
    (supplied.envelope.command as { enabled: boolean }).enabled = true;
    const sim = restoreSimulation(saved, { content: testContent() }).sim;
    const snapshot = sim.commands.continuationSnapshot();
    (snapshot[0]?.envelope.command as { enabled: boolean }).enabled = true;
    expect(sim.commands.continuationSnapshot()[0]?.envelope.command).toEqual(
      input(3, false).envelope.command,
    );
    sim.commands.enqueueAt(input(4, true).envelope, 4, 0);
    expect(restore(sim).commands.scheduledCount).toBe(0);
    sim.commands.discardPending();
    sim.run(4);
    expect(sim.commands.log).toEqual([]);
  });

  it.each([
    undefined,
    null,
    [{ applyTick: 0, envelope: input(1, true).envelope }],
    [input(2, true), input(1, false)],
    [input(1.5, true)],
    [input(Number.MAX_SAFE_INTEGER + 1, true)],
    [{ ...input(1, true), sequence: 0 }],
    [{ applyTick: 1, envelope: { v: 1, origin: 'invalid' } }],
  ])('rejects malformed continuation %j', (continuation) => {
    const save = exportSaveGame(create());
    const invalid = {
      ...save,
      sections: save.sections.map((s) => (s.id === 'commands' ? { ...s, continuation } : s)),
    };
    expect(() => parseSaveGame(invalid)).toThrow();
  });

  it('rejects captured input at or before the captured tick', () => {
    const sim = create();
    sim.run(2);
    expect(() => exportSaveGame(sim, { continuation: [input(2, true)] })).toThrow(/after saved tick/);
    expect(() => withSaveContinuation(exportSaveGame(sim), [input(1, true)])).toThrow(/after saved tick/);
  });
});
