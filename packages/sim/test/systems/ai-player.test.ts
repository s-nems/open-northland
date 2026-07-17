import { describe, expect, it } from 'vitest';
import { AiPlayer, aiPlayerEntity, isAiPlayer } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { CommandQueue, EventBuffer, Rng, replay, Simulation, stepReplaying } from '../../src/index.js';
import {
  AI_DECISION_INTERVAL_TICKS,
  type AiPlayerModule,
  runAiPlayerModules,
} from '../../src/systems/ai-player/index.js';
import type { SystemContext } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The strategic AI-player scaffold: the `setPlayerAi` seat flag, the AiPlayerSystem's staggered
 * decision cadence, the module enable gates, and the replay seam (re-emitted AI commands are
 * discarded — the log's copies apply verbatim). Modules ship empty; these tests drive the seam
 * with stubs.
 */

const AI_SEAT = 2;
const OTHER_SEAT = 5;
const INVALID_PLAYER = 99;

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

describe('setPlayerAi — the AI seat flag', () => {
  it('flags a seat with all modules enabled by default', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.step();
    expect(isAiPlayer(sim.world, AI_SEAT)).toBe(true);
    expect(isAiPlayer(sim.world, OTHER_SEAT)).toBe(false);
    const carrier = aiPlayerEntity(sim.world, AI_SEAT);
    expect(carrier).not.toBeNull();
    if (carrier === null) return;
    const seat = sim.world.get(carrier, AiPlayer);
    expect(Object.values(seat.modules).every((enabled) => enabled)).toBe(true);
  });

  it('fills a partial module override with enabled defaults and updates the carrier in place', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.step();
    const carrier = aiPlayerEntity(sim.world, AI_SEAT);
    sim.enqueue({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(aiPlayerEntity(sim.world, AI_SEAT)).toBe(carrier); // updated, not re-created
    if (carrier === null) return;
    const seat = sim.world.get(carrier, AiPlayer);
    expect(seat.modules.military).toBe(false);
    expect(seat.modules.houseBuild).toBe(true);
  });

  it('removes the seat on disable and skips an out-of-range player (still logged)', () => {
    const sim = fresh();
    sim.enqueue({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.enqueue({ kind: 'setPlayerAi', player: INVALID_PLAYER, enabled: true });
    sim.step();
    expect(isAiPlayer(sim.world, AI_SEAT)).toBe(true);
    expect(isAiPlayer(sim.world, INVALID_PLAYER)).toBe(false);
    expect(sim.commands.log).toHaveLength(2); // the skipped command still replays

    sim.enqueue({ kind: 'setPlayerAi', player: AI_SEAT, enabled: false });
    sim.step();
    expect(isAiPlayer(sim.world, AI_SEAT)).toBe(false);
  });
});

/** A world with one AI seat per given player, added directly (a pre-tick fixture). */
function worldWithSeats(...players: readonly number[]): World {
  const world = new World();
  for (const player of players) {
    world.add(world.create(), AiPlayer, {
      player,
      modules: {
        collectResources: true,
        guideBuild: true,
        homeExpansion: true,
        houseBuild: true,
        houseUpgrade: true,
        military: player !== OTHER_SEAT, // OTHER_SEAT ships one disabled module for the gate test
        roadBuild: true,
      },
    });
  }
  return world;
}

function ctxAt(tick: number, commands: CommandQueue): SystemContext {
  return { content: testContent(), rng: new Rng(1), tick, events: new EventBuffer(), commands };
}

describe('AiPlayerSystem — cadence, stagger, and module gates', () => {
  it('runs each seat only on its stagger slot of the decision interval and enqueues its commands', () => {
    const world = worldWithSeats(0, OTHER_SEAT);
    const commands = new CommandQueue();
    const calls: Array<{ tick: number; player: number }> = [];
    const stub: AiPlayerModule = {
      id: 'houseBuild',
      run: (_w, ctx, player) => {
        calls.push({ tick: ctx.tick, player });
        return [{ kind: 'setNeedsEnabled', enabled: true }];
      },
    };
    for (let tick = 1; tick <= 2 * AI_DECISION_INTERVAL_TICKS; tick++) {
      runAiPlayerModules(world, ctxAt(tick, commands), [stub]);
    }
    expect(calls).toEqual([
      { tick: OTHER_SEAT, player: OTHER_SEAT },
      { tick: AI_DECISION_INTERVAL_TICKS, player: 0 },
      { tick: AI_DECISION_INTERVAL_TICKS + OTHER_SEAT, player: OTHER_SEAT },
      { tick: 2 * AI_DECISION_INTERVAL_TICKS, player: 0 },
    ]);
    expect(commands.pendingCount).toBe(calls.length); // every returned command was enqueued
  });

  it('skips a disabled module for the seat that disabled it and runs it for the rest', () => {
    const world = worldWithSeats(0, OTHER_SEAT); // OTHER_SEAT has `military` disabled
    const commands = new CommandQueue();
    const militaryRuns: number[] = [];
    const houseRuns: number[] = [];
    const military: AiPlayerModule = {
      id: 'military',
      run: (_w, _c, p) => {
        militaryRuns.push(p);
        return [];
      },
    };
    const house: AiPlayerModule = {
      id: 'houseBuild',
      run: (_w, _c, p) => {
        houseRuns.push(p);
        return [];
      },
    };
    for (let tick = 1; tick <= AI_DECISION_INTERVAL_TICKS; tick++) {
      runAiPlayerModules(world, ctxAt(tick, commands), [military, house]);
    }
    expect(militaryRuns).toEqual([0]);
    expect(houseRuns).toEqual([OTHER_SEAT, 0]);
  });

  it('gives a non-flagged player zero AI decisions', () => {
    const world = worldWithSeats(AI_SEAT);
    const commands = new CommandQueue();
    const seen: number[] = [];
    const stub: AiPlayerModule = {
      id: 'houseBuild',
      run: (_w, _c, p) => {
        seen.push(p);
        return [];
      },
    };
    for (let tick = 1; tick <= 2 * AI_DECISION_INTERVAL_TICKS; tick++) {
      runAiPlayerModules(world, ctxAt(tick, commands), [stub]);
    }
    expect(seen).toEqual([AI_SEAT, AI_SEAT]); // only the flagged seat, on its two due ticks
  });
});

describe('AI seat determinism and replay', () => {
  const TICKS = 60;

  function liveRun(): Simulation {
    const sim = fresh(7);
    sim.enqueue({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true, modules: { roadBuild: false } });
    sim.enqueue({ kind: 'spawnSettler', jobType: 1, x: 2, y: 2, tribe: 1, owner: AI_SEAT });
    sim.run(TICKS);
    return sim;
  }

  it('same seed + an AI-flagged seat twice → byte-identical hashes', () => {
    expect(liveRun().hashState()).toBe(liveRun().hashState());
  });

  it('replaying the log reproduces the state, discarding commands the replaying sim re-emits', () => {
    const live = liveRun();
    const replayed = replay({ content: testContent(), seed: 7, log: live.commands.log, untilTick: TICKS });
    expect(replayed.hashState()).toBe(live.hashState());

    // The discard seam itself: a command left pending mid-replay (what an AI module's live re-emission
    // is — its applied copy already sits in the log) must be thrown away, never double-applied.
    const strayed = new Simulation({ seed: 7, content: testContent() });
    stepReplaying(strayed, live.commands.log, TICKS, () => {
      strayed.enqueue({ kind: 'setNeedsEnabled', enabled: false }); // would move the hash if applied
    });
    expect(strayed.hashState()).toBe(live.hashState());
  });
});
