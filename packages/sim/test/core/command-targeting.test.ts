import { describe, expect, it } from 'vitest';
import {
  adminCommand,
  type CommandsSection,
  exportSaveGame,
  parseSaveGame,
  replay,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tick-targeted admission is what a lockstep session needs from the queue: an envelope stamped for a
 * tick applies on exactly that tick, in the position the stamp gives it, however it arrived. These
 * pin that contract against the untargeted next-tick path, which single-player still uses.
 */

const SEED = 5;

function sim(): Simulation {
  return new Simulation({ seed: SEED, content: testContent() });
}

/** A rules toggle: trusted, mapless, and readable straight off the sim, so the tick a command landed
 *  on is observable without a settler in the way. */
function setNeeds(enabled: boolean) {
  return adminCommand({ kind: 'setNeedsEnabled', enabled });
}

function commandsSection(saved: Simulation): CommandsSection {
  const parsed = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(saved))));
  const section = parsed.sections.find((s) => s.id === 'commands');
  if (section?.id !== 'commands') throw new Error('the save carries no commands section');
  return section;
}

describe('tick-targeted commands', () => {
  it('applies a targeted envelope on exactly its tick', () => {
    const s = sim();
    s.enqueueAt(setNeeds(false), 3, 0);

    s.step();
    expect(s.needsEnabled()).toBe(true);
    s.step();
    expect(s.needsEnabled()).toBe(true);
    expect(s.commands.scheduledCount).toBe(1);

    s.step();
    expect(s.needsEnabled()).toBe(false);
    expect(s.commands.scheduledCount).toBe(0);
    expect(s.commands.log.map((e) => e.applyTick)).toEqual([3]);
  });

  it('orders one tick by assigned sequence, not by arrival', () => {
    const s = sim();
    // Enqueued last-first: only the stamps may decide, or two clients receiving them in different
    // orders would apply them in different orders.
    s.enqueueAt(setNeeds(true), 2, 1);
    s.enqueueAt(setNeeds(false), 2, 0);
    s.run(2);

    expect(s.needsEnabled()).toBe(true);
    expect(s.commands.log.map((e) => e.command)).toEqual([
      { kind: 'setNeedsEnabled', enabled: false },
      { kind: 'setNeedsEnabled', enabled: true },
    ]);
  });

  it('applies the untargeted envelopes of a tick before the ones stamped for it', () => {
    // A session stamps its seats' orders; the world's own emissions - an AI seat's commands, authored
    // setup - stay untargeted, so keeping them first leaves a stamped order landing exactly where the
    // same order landed before it was stamped.
    const s = sim();
    s.enqueue(setNeeds(true));
    s.enqueueAt(setNeeds(false), 1, 0);
    s.step();

    expect(s.needsEnabled()).toBe(false); // the stamped one landed last
    expect(s.commands.log.map((e) => e.command)).toEqual([
      { kind: 'setNeedsEnabled', enabled: true },
      { kind: 'setNeedsEnabled', enabled: false },
    ]);
  });

  it('drops an envelope whose tick has passed, and keeps it out of the log', () => {
    const late = sim();
    late.run(3);
    late.enqueueAt(setNeeds(false), 1, 0);
    late.step();

    const clean = sim();
    clean.run(4);

    expect(late.needsEnabled()).toBe(true);
    expect(late.hashState()).toBe(clean.hashState());
    expect(late.commands.lateDrops).toBe(1);
    // Never logged: the tick a late packet arrives on is local, so logging it would both replay as an
    // applied command and give two clients of one session different logs for the same packet.
    expect(late.commands.log).toHaveLength(0);

    const replayed = replay({ content: testContent(), seed: SEED, log: late.commands.log, untilTick: 4 });
    expect(replayed.hashState()).toBe(late.hashState());
  });

  it('replays a run whose commands were stamped', () => {
    const live = sim();
    live.enqueueAt(setNeeds(false), 2, 1);
    live.enqueueAt(setNeeds(true), 2, 0);
    live.enqueue(setNeeds(false));
    live.run(5);

    const replayed = replay({ content: testContent(), seed: SEED, log: live.commands.log, untilTick: 5 });
    expect(replayed.hashState()).toBe(live.hashState());
    expect(replayed.needsEnabled()).toBe(live.needsEnabled());
  });

  it('refuses a second envelope claiming one position, before the queue holds it', () => {
    const s = sim();
    s.enqueueAt(setNeeds(false), 2, 0);

    expect(() => s.enqueueAt(setNeeds(true), 2, 0)).toThrow(/two commands claim tick 2 sequence 0/);
    // The refusal costs the queue nothing: the position's first claimant still applies on its tick.
    expect(s.commands.scheduledCount).toBe(1);
    s.run(2);
    expect(s.needsEnabled()).toBe(false);
  });

  it('rejects a target tick or sequence that is not a whole count', () => {
    const s = sim();
    expect(() => s.enqueueAt(setNeeds(false), 1.5, 0)).toThrow(/applyTick must be a non-negative integer/);
    expect(() => s.enqueueAt(setNeeds(false), 1, -1)).toThrow(/sequence must be a non-negative integer/);
  });

  it('does not reserve a position when copying a payload fails', () => {
    const s = sim();
    const malformed = adminCommand({ kind: 'setNeedsEnabled', enabled: false });
    Object.assign(malformed.command, { unsupported: new Set([1]) });
    expect(() => s.enqueueAt(malformed, 1, 0)).toThrow(/non-serializable/);
    expect(() => s.enqueueAt(setNeeds(false), 1, 0)).not.toThrow();
    s.step();
    expect(s.needsEnabled()).toBe(false);
  });

  it('rejects target positions outside the exact integer range', () => {
    const s = sim();
    expect(() => s.enqueueAt(setNeeds(false), 1e30, 0)).toThrow(/applyTick/);
    expect(() => s.enqueueAt(setNeeds(false), 1, 1e30)).toThrow(/sequence/);
  });

  it('keeps next-tick semantics for an untargeted envelope', () => {
    const s = sim();
    s.enqueue(setNeeds(false));
    expect(s.commands.pendingCount).toBe(1);

    s.step();
    expect(s.needsEnabled()).toBe(false);
    expect(s.commands.log.map((e) => e.applyTick)).toEqual([1]);
  });
});

describe('a save taken with commands in flight', () => {
  it('omits the targeted ones and restores to the tick it was taken at', () => {
    const s = sim();
    s.run(2);
    s.enqueueAt(setNeeds(false), 5, 0);
    s.enqueue(setNeeds(false));

    // The session's own command stream reconstructs what was scheduled past the saved tick; the
    // untargeted queue is local state the save still carries.
    expect(commandsSection(s).pending).toEqual([{ ...setNeeds(false) }]);

    const parsed = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(s))));
    const restored = restoreSimulation(parsed, { content: testContent() });
    expect(restored.hashState()).toBe(s.hashState());
    expect(restored.commands.scheduledCount).toBe(0);
    expect(restored.commands.pendingCount).toBe(1);
  });
});
