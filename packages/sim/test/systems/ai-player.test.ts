import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { AiPlayer, aiPlayerEntity, isAiPlayer } from '../../src/components/index.js';
import { CommandQueue } from '../../src/core/command-queue.js';
import { PersonalNames } from '../../src/core/personal-names.js';
import { type Entity, World } from '../../src/ecs/world.js';
import { EventBuffer, Rng, replay, Simulation, stepReplaying } from '../../src/index.js';
import {
  AI_DECISION_INTERVAL_TICKS,
  AI_MODULE_PHASE_TICKS,
  AI_PLAYER_MODULES,
  type AiPlayerModule,
  aiDecisionDue,
  runAiPlayerModules,
} from '../../src/systems/ai-player/index.js';
import { outfitGrantOrders } from '../../src/systems/ai-player/military/outfit.js';
import {
  FLAG_RELOCATE_EVERY_DECISIONS,
  flagRelocateDue,
} from '../../src/systems/ai-player/workforce/collectors/upkeep.js';
import type { SystemContext } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The strategic AI-player scaffold: the `setPlayerAi` seat flag, the AiPlayerSystem's staggered
 * decision cadence, the module enable gates, and the replay seam (re-emitted AI commands are
 * discarded - the log's copies apply verbatim). Modules ship empty; these tests drive the seam
 * with stubs.
 */

const AI_SEAT = 2;
const OTHER_SEAT = 5;
const INVALID_PLAYER = 99;
/** Any entity ref: the stub module's command is counted, never applied. */
const STUB_UNIT = 1 as Entity;

function fresh(seed = 1): Simulation {
  return new Simulation({ seed, content: testContent() });
}

/** Fixture goods the soldier outfit names: the two amulets and the small healing potion ship, the big
 *  potion is appended. */
const SHOES = 8;
const HEAL_SMALL = 16;
const STRENGTH_AMULET = 25;
const DEFENCE_AMULET = 26;
const HEAL_BIG = 60;
/** Ticks for every module of a seat to take one decision. */
const DECISION_ROUND_TICKS = AI_DECISION_INTERVAL_TICKS + AI_PLAYER_MODULES.length;

function outfitContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      {
        typeId: HEAL_BIG,
        id: 'potion_heal_big',
        weight: 0,
        equip: { category: 'misc', wears: true, uses: 5, restorePct: { healthMax: 40 } },
      },
    ],
  });
}

describe('setPlayerAi - the AI seat flag', () => {
  it('flags a seat with all modules enabled by default', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
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
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.step();
    const carrier = aiPlayerEntity(sim.world, AI_SEAT);
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(aiPlayerEntity(sim.world, AI_SEAT)).toBe(carrier); // updated, not re-created
    if (carrier === null) return;
    const seat = sim.world.get(carrier, AiPlayer);
    expect(seat.modules.military).toBe(false);
    expect(seat.modules.houseBuild).toBe(true);
  });

  it('follows a carrier re-seated in place after an earlier lookup', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.step();
    const carrier = aiPlayerEntity(sim.world, AI_SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.mut(carrier, AiPlayer).player = OTHER_SEAT;
    expect(aiPlayerEntity(sim.world, AI_SEAT)).toBeNull();
    expect(aiPlayerEntity(sim.world, OTHER_SEAT)).toBe(carrier);
  });

  it('removes the seat on disable and skips an out-of-range player (still logged)', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: INVALID_PLAYER, enabled: true });
    sim.step();
    expect(isAiPlayer(sim.world, AI_SEAT)).toBe(true);
    expect(isAiPlayer(sim.world, INVALID_PLAYER)).toBe(false);
    expect(sim.commands.log).toHaveLength(2); // the skipped command still replays

    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: false });
    sim.step();
    expect(isAiPlayer(sim.world, AI_SEAT)).toBe(false);
  });

  it('withdraws every AI-published counter on disable', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    // The standing state the modules publish: the births, and the garrison rung's whole weapon mix.
    const published = ['extraMen', 'trainSoldiers', 'trainSword', 'trainSpear', 'trainBow'] as const;
    for (const counter of published) {
      sim.enqueueSetup({ kind: 'setAssistantCounter', player: AI_SEAT, counter, value: 3, infinite: false });
    }
    sim.step();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: false });
    sim.step();
    const counters = sim.assistantCounters(AI_SEAT);
    for (const counter of published) {
      expect(counters[counter], counter).toEqual({ value: 0, infinite: false });
    }
  });

  it("withdraws a module's counters when its publishing gate flips off, keeping the rest", () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({
      kind: 'setAssistantCounter',
      player: AI_SEAT,
      counter: 'extraWomen',
      value: 4,
      infinite: false,
    });
    sim.enqueueSetup({
      kind: 'setAssistantCounter',
      player: AI_SEAT,
      counter: 'trainSoldiers',
      value: 5,
      infinite: false,
    });
    sim.step();
    // `military` off breaks the garrison rung's publishing conjunction; the births keep their module.
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(sim.assistantCounters(AI_SEAT).trainSoldiers.value).toBe(0);
    expect(sim.assistantCounters(AI_SEAT).extraWomen.value).toBe(4);
  });

  it('publishes the soldier outfit as soldiers-only assistant grants until it stands, and withdraws it with the military module', () => {
    const sim = new Simulation({ seed: 1, content: outfitContent(), map: grassNodeMap(32, 32) });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.step();
    const published = outfitGrantOrders(sim.world, ctxOf(sim), AI_SEAT);
    // Each good's limit before its grant, so no civilian is dressed in the tick between.
    const outfit = [HEAL_BIG, HEAL_SMALL, DEFENCE_AMULET, STRENGTH_AMULET];
    expect(published).toEqual(
      outfit.flatMap((goodType) => [
        { kind: 'setAssistantGrantAudience', player: AI_SEAT, goodType, soldiersOnly: true },
        { kind: 'setAssistantGrant', player: AI_SEAT, goodType, enabled: true },
      ]),
    );
    const standing = [HEAL_SMALL, STRENGTH_AMULET, DEFENCE_AMULET, HEAL_BIG];
    // The live module publishes the same within a decision round.
    sim.run(DECISION_ROUND_TICKS);
    expect(outfitGrantOrders(sim.world, ctxOf(sim), AI_SEAT)).toEqual([]); // standing: nothing to re-issue
    expect(sim.assistantGrants(AI_SEAT)).toEqual(standing);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual(standing);

    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(sim.assistantGrants(AI_SEAT)).toEqual([]);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual([]);
    // The home half the seat keeps running with the module off republishes nothing.
    sim.run(2 * DECISION_ROUND_TICKS);
    expect(sim.assistantGrants(AI_SEAT)).toEqual([]);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual([]);

    // A grant and a limit another hand set survive the withdrawal of the outfit.
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantGrant', player: AI_SEAT, goodType: SHOES, enabled: true });
    sim.enqueueSetup({
      kind: 'setAssistantGrantAudience',
      player: AI_SEAT,
      goodType: SHOES,
      soldiersOnly: true,
    });
    for (const command of published) sim.enqueueSetup(command);
    sim.step();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: false });
    sim.step();
    expect(sim.assistantGrants(AI_SEAT)).toEqual([SHOES]);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual([SHOES]);
  });

  it('switches the flag follow off on disable, and when the workforce module turns off', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantMoveFlags', player: AI_SEAT, enabled: true });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(true);
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: false });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(false);

    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantMoveFlags', player: AI_SEAT, enabled: true });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(true);
    sim.enqueueSetup({
      kind: 'setPlayerAi',
      player: AI_SEAT,
      enabled: true,
      modules: { collectResources: false },
    });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(false);
  });

  it("leaves a never-AI seat's counters alone on a redundant disable", () => {
    const sim = fresh();
    sim.enqueueSetup({
      kind: 'setAssistantCounter',
      player: OTHER_SEAT,
      counter: 'trainSpear',
      value: 7,
      infinite: false,
    });
    sim.enqueueSetup({ kind: 'setPlayerAi', player: OTHER_SEAT, enabled: false });
    sim.step();
    expect(sim.assistantCounters(OTHER_SEAT).trainSpear.value).toBe(7);
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
      scripted: true,
      difficulty: 'hard',
    });
  }
  return world;
}

function ctxAt(tick: number, commands: CommandQueue): SystemContext {
  return {
    content: testContent(),
    rng: new Rng(1),
    names: new PersonalNames(1, []),
    tick,
    events: new EventBuffer(),
    commands,
  };
}

describe('AiPlayerSystem - cadence, stagger, and module gates', () => {
  it('runs each seat only on its stagger slot of the decision interval and enqueues its commands', () => {
    const world = worldWithSeats(0, OTHER_SEAT);
    const commands = new CommandQueue();
    const calls: Array<{ tick: number; player: number }> = [];
    const stub: AiPlayerModule = {
      id: 'houseBuild',
      run: (_w, ctx, player) => {
        calls.push({ tick: ctx.tick, player });
        return [{ kind: 'marry', entity: STUB_UNIT }];
      },
    };
    for (let tick = 1; tick <= 2 * AI_DECISION_INTERVAL_TICKS; tick++) {
      runAiPlayerModules(world, ctxAt(tick, commands), [stub]);
    }
    const OTHER_SEAT_SLOT = 35; // (5 × 7) mod 48
    expect(calls).toEqual([
      { tick: OTHER_SEAT_SLOT, player: OTHER_SEAT },
      { tick: AI_DECISION_INTERVAL_TICKS, player: 0 },
      { tick: AI_DECISION_INTERVAL_TICKS + OTHER_SEAT_SLOT, player: OTHER_SEAT },
      { tick: 2 * AI_DECISION_INTERVAL_TICKS, player: 0 },
    ]);
    expect(commands.pendingCount).toBe(calls.length); // every returned command was enqueued
  });

  it('keeps seven seats at least six ticks apart around the interval', () => {
    const SEATS = 7;
    const MIN_GAP_TICKS = 6;
    const slots: number[] = [];
    for (let player = 0; player < SEATS; player++) {
      const due = [];
      for (let tick = 0; tick < AI_DECISION_INTERVAL_TICKS; tick++)
        if (aiDecisionDue(tick, player)) due.push(tick);
      expect(due).toHaveLength(1);
      slots.push(...due);
    }
    slots.sort((a, b) => a - b);
    const gaps = slots.map(
      (slot, i) => (slots[i + 1] ?? AI_DECISION_INTERVAL_TICKS + (slots[0] ?? 0)) - slot,
    );
    expect(Math.min(...gaps)).toBe(MIN_GAP_TICKS);
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
    // Past the tick-0 decision's second module, and one phase past the interval, so the tick-48 decision's
    // second module runs too.
    for (
      let tick = 2 * AI_MODULE_PHASE_TICKS;
      tick <= AI_DECISION_INTERVAL_TICKS + AI_MODULE_PHASE_TICKS;
      tick++
    ) {
      runAiPlayerModules(world, ctxAt(tick, commands), [military, house]);
    }
    expect(militaryRuns).toEqual([0]);
    expect(houseRuns).toEqual([OTHER_SEAT, 0]);
  });

  it('runs each module of a decision on its own tick, no two of seven seats sharing one', () => {
    const SEATS = 7;
    const world = worldWithSeats(...Array.from({ length: SEATS }, (_, player) => player));
    const commands = new CommandQueue();
    const runs: Array<{ tick: number; player: number; module: number }> = [];
    const modules = AI_PLAYER_MODULES.map(
      (_, module): AiPlayerModule => ({
        id: 'houseBuild',
        run: (_w, ctx, player) => {
          runs.push({ tick: ctx.tick, player, module });
          return [];
        },
      }),
    );
    for (let tick = AI_DECISION_INTERVAL_TICKS; tick < 2 * AI_DECISION_INTERVAL_TICKS; tick++) {
      runAiPlayerModules(world, ctxAt(tick, commands), modules);
    }
    expect(runs).toHaveLength(SEATS * modules.length);
    expect(new Set(runs.map((run) => run.tick)).size).toBe(runs.length);
    for (const run of runs) {
      const slot = run.tick - run.module * AI_MODULE_PHASE_TICKS;
      expect(aiDecisionDue(slot, run.player)).toBe(true);
    }
  });

  it('re-aims each collector flag once a round, spreading consecutive holders over its decisions', () => {
    const HOLDERS = 2 * FLAG_RELOCATE_EVERY_DECISIONS;
    const dueByDecision: number[] = [];
    for (let decision = 0; decision < FLAG_RELOCATE_EVERY_DECISIONS; decision++) {
      const ctx = ctxAt(decision * AI_DECISION_INTERVAL_TICKS, new CommandQueue());
      let due = 0;
      for (let holder = 0; holder < HOLDERS; holder++) if (flagRelocateDue(ctx, holder as Entity)) due++;
      dueByDecision.push(due);
    }
    expect(dueByDecision).toEqual(new Array(FLAG_RELOCATE_EVERY_DECISIONS).fill(2));
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
    sim.enqueueSetup({ kind: 'setPlayerAi', player: AI_SEAT, enabled: true, modules: { roadBuild: false } });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 1, x: 2, y: 2, tribe: 1, owner: AI_SEAT });
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
    // is - its applied copy already sits in the log) must be thrown away, never double-applied.
    const strayed = new Simulation({ seed: 7, content: testContent() });
    stepReplaying(strayed, live.commands.log, TICKS, () => {
      strayed.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false }); // would move the hash if applied
    });
    expect(strayed.hashState()).toBe(live.hashState());
  });
});
