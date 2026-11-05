import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { AiControl, aiControlEntity, isMachinePlayer, MAX_PLAYERS } from '../../../src/components/index.js';
import { CommandQueue } from '../../../src/core/command-queue.js';
import { PersonalNames } from '../../../src/core/personal-names.js';
import { type Entity, World } from '../../../src/ecs/world.js';
import { EventBuffer, Rng, replay, Simulation, stepReplaying } from '../../../src/index.js';
import {
  AI_SEAT_SLOT_STEP_TICKS,
  COMPUTER_DECISION_INTERVAL_TICKS,
  COMPUTER_MODULE_PHASE_TICKS,
  COMPUTER_MODULES,
  type ComputerModule,
  computerDecisionDue,
  computerDecisionSlot,
  runComputerModules,
  WORKFORCE_EVERY_DECISIONS,
} from '../../../src/systems/computer-player/index.js';
import { outfitGrantOrders } from '../../../src/systems/computer-player/military/outfit.js';
import {
  FLAG_RELOCATE_EVERY_RUNS,
  flagRelocateDue,
} from '../../../src/systems/computer-player/workforce/collectors/upkeep.js';
import { settlementGrantOrders } from '../../../src/systems/computer-player/workforce/grants.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/**
 * The strategic AI-player scaffold: the `setAiControl` seat flag, the computerPlayerSystem's staggered
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

/** Fixture goods the soldier outfit names: the amulets and the small healing potion ship, the big potion
 *  is appended. */
const HEAL_SMALL = 16;
const FOOD_AMULET = 23;
const STAMINA_AMULET = 24;
const STRENGTH_AMULET = 25;
const DEFENCE_AMULET = 26;
const CRIT_AMULET = 27;
const SPEED_AMULET = 28;
const HEAL_BIG = 60;
/** Fixture goods the settlement grants name. */
const SHOES = 8;
const WOODEN_TOOL = 11;
const IRON_TOOL = 12;
const MEAD = 13;
/** Fixture goods neither the soldier outfit nor the settlement grants name. */
const FUR_BOOTS = 10;
const STAMINA_POTION = 15;
/** Ticks for every module of a seat to take one decision. */
const DECISION_ROUND_TICKS = COMPUTER_DECISION_INTERVAL_TICKS + COMPUTER_MODULES.length;

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

describe('setAiControl - the AI seat flag', () => {
  it('flags a seat with all modules enabled by default', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.step();
    expect(isMachinePlayer(sim.world, AI_SEAT)).toBe(true);
    expect(isMachinePlayer(sim.world, OTHER_SEAT)).toBe(false);
    const carrier = aiControlEntity(sim.world, AI_SEAT);
    expect(carrier).not.toBeNull();
    if (carrier === null) return;
    const seat = sim.world.get(carrier, AiControl);
    expect(Object.values(seat.modules).every((enabled) => enabled)).toBe(true);
  });

  it('fills a partial module override with enabled defaults and updates the carrier in place', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.step();
    const carrier = aiControlEntity(sim.world, AI_SEAT);
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(aiControlEntity(sim.world, AI_SEAT)).toBe(carrier); // updated, not re-created
    if (carrier === null) return;
    const seat = sim.world.get(carrier, AiControl);
    expect(seat.modules.military).toBe(false);
    expect(seat.modules.houseBuild).toBe(true);
  });

  it('follows a carrier re-seated in place after an earlier lookup', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.step();
    const carrier = aiControlEntity(sim.world, AI_SEAT);
    if (carrier === null) throw new Error('setup: no carrier');
    sim.world.mut(carrier, AiControl).player = OTHER_SEAT;
    expect(aiControlEntity(sim.world, AI_SEAT)).toBeNull();
    expect(aiControlEntity(sim.world, OTHER_SEAT)).toBe(carrier);
  });

  it('removes the seat on disable and skips an out-of-range player (still logged)', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAiControl', player: INVALID_PLAYER, enabled: true });
    sim.step();
    expect(isMachinePlayer(sim.world, AI_SEAT)).toBe(true);
    expect(isMachinePlayer(sim.world, INVALID_PLAYER)).toBe(false);
    expect(sim.commands.log).toHaveLength(2); // the skipped command still replays

    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: false });
    sim.step();
    expect(isMachinePlayer(sim.world, AI_SEAT)).toBe(false);
  });

  it('withdraws every AI-published counter on disable', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    // The standing state the modules publish: the births, and the garrison rung's whole weapon mix.
    const published = ['extraMen', 'trainSoldiers', 'trainSword', 'trainSpear', 'trainBow'] as const;
    for (const counter of published) {
      sim.enqueueSetup({ kind: 'setAssistantCounter', player: AI_SEAT, counter, value: 3, infinite: false });
    }
    sim.step();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: false });
    sim.step();
    const counters = sim.assistantCounters(AI_SEAT);
    for (const counter of published) {
      expect(counters[counter], counter).toEqual({ value: 0, infinite: false });
    }
  });

  it("withdraws a module's counters when its publishing gate flips off, keeping the rest", () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
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
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(sim.assistantCounters(AI_SEAT).trainSoldiers.value).toBe(0);
    expect(sim.assistantCounters(AI_SEAT).extraWomen.value).toBe(4);
  });

  it('publishes the soldier outfit as soldiers-only assistant grants until it stands, and withdraws it with the military module', () => {
    const sim = new Simulation({ seed: 1, content: outfitContent(), map: grassNodeMap(32, 32) });
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.step();
    const published = outfitGrantOrders(sim.world, ctxOf(sim), AI_SEAT);
    // Each good's limit before its grant, so no civilian is dressed in the tick between.
    const outfit = [
      HEAL_BIG,
      HEAL_SMALL,
      DEFENCE_AMULET,
      STRENGTH_AMULET,
      FOOD_AMULET,
      STAMINA_AMULET,
      CRIT_AMULET,
      SPEED_AMULET,
    ];
    expect(published).toEqual(
      outfit.flatMap((goodType) => [
        { kind: 'setAssistantGrantAudience', player: AI_SEAT, goodType, audience: 'soldiers' },
        { kind: 'setAssistantGrant', player: AI_SEAT, goodType, enabled: true },
      ]),
    );
    const standing = [...outfit].sort((a, b) => a - b);
    // The live module publishes the same within a decision round.
    sim.run(DECISION_ROUND_TICKS);
    expect(outfitGrantOrders(sim.world, ctxOf(sim), AI_SEAT)).toEqual([]); // standing: nothing to re-issue
    expect(sim.assistantGrants(AI_SEAT)).toEqual(standing);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual(standing);

    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true, modules: { military: false } });
    sim.step();
    expect(sim.assistantGrants(AI_SEAT)).toEqual([]);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual([]);
    // The home half the seat keeps running with the module off republishes nothing.
    sim.run(2 * DECISION_ROUND_TICKS);
    expect(sim.assistantGrants(AI_SEAT)).toEqual([]);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual([]);

    // A grant and a limit another hand set survive the withdrawal of the outfit.
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantGrant', player: AI_SEAT, goodType: FUR_BOOTS, enabled: true });
    sim.enqueueSetup({
      kind: 'setAssistantGrantAudience',
      player: AI_SEAT,
      goodType: STAMINA_POTION,
      audience: 'soldiers',
    });
    for (const command of published) sim.enqueueSetup(command);
    sim.step();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: false });
    sim.step();
    expect(sim.assistantGrants(AI_SEAT)).toEqual([FUR_BOOTS]);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual([STAMINA_POTION]);
  });

  it('grants mead, shoes and tools to every settler, and withdraws them with the workforce module or the seat', () => {
    const sim = new Simulation({ seed: 1, content: outfitContent(), map: grassNodeMap(32, 32) });
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.step();
    const published = settlementGrantOrders(sim.world, ctxOf(sim), AI_SEAT);
    expect(published).toEqual(
      [MEAD, SHOES, IRON_TOOL, WOODEN_TOOL].map((goodType) => ({
        kind: 'setAssistantGrant',
        player: AI_SEAT,
        goodType,
        enabled: true,
      })),
    );
    for (const command of published) sim.enqueueSetup(command);
    sim.step();
    expect(settlementGrantOrders(sim.world, ctxOf(sim), AI_SEAT)).toEqual([]);
    expect(sim.assistantSoldierOnlyGrants(AI_SEAT)).toEqual([]);

    sim.enqueueSetup({
      kind: 'setAiControl',
      player: AI_SEAT,
      enabled: true,
      modules: { collectResources: false, military: false },
    });
    sim.step();
    expect(sim.assistantGrants(AI_SEAT)).toEqual([]);

    // The seat handed back to a player loses them too.
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    for (const command of published) sim.enqueueSetup(command);
    sim.step();
    expect(sim.assistantGrants(AI_SEAT)).toEqual([SHOES, WOODEN_TOOL, IRON_TOOL, MEAD]);
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: false });
    sim.step();
    expect(sim.assistantGrants(AI_SEAT)).toEqual([]);
  });

  it('switches the flag follow and the tool upgrade off on disable, and when the workforce module turns off', () => {
    const sim = fresh();
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantMoveFlags', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantUpgradeTools', player: AI_SEAT, enabled: true });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(true);
    expect(sim.assistantUpgradesTools(AI_SEAT)).toBe(true);
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: false });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(false);
    expect(sim.assistantUpgradesTools(AI_SEAT)).toBe(false);

    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantMoveFlags', player: AI_SEAT, enabled: true });
    sim.enqueueSetup({ kind: 'setAssistantUpgradeTools', player: AI_SEAT, enabled: true });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(true);
    expect(sim.assistantUpgradesTools(AI_SEAT)).toBe(true);
    sim.enqueueSetup({
      kind: 'setAiControl',
      player: AI_SEAT,
      enabled: true,
      computerEnabled: true,
      modules: { collectResources: false },
    });
    sim.step();
    expect(sim.assistantMovesFlags(AI_SEAT)).toBe(false);
    expect(sim.assistantUpgradesTools(AI_SEAT)).toBe(false);
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
    sim.enqueueSetup({ kind: 'setAiControl', player: OTHER_SEAT, enabled: false });
    sim.step();
    expect(sim.assistantCounters(OTHER_SEAT).trainSpear.value).toBe(7);
  });
});

/** A world with one AI seat per given player, added directly (a pre-tick fixture). */
function worldWithSeats(...players: readonly number[]): World {
  const world = new World();
  for (const player of players) {
    world.add(world.create(), AiControl, {
      player,
      computerEnabled: true,
      modules: {
        collectResources: true,
        guideBuild: true,
        homeExpansion: true,
        houseBuild: true,
        houseUpgrade: true,
        military: player !== OTHER_SEAT, // OTHER_SEAT ships one disabled module for the gate test
        roadBuild: true,
      },
      mapAiEnabled: true,
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

describe('computerPlayerSystem - cadence, stagger, and module gates', () => {
  it('runs each seat only on its stagger slot of the decision interval and enqueues its commands', () => {
    const world = worldWithSeats(0, OTHER_SEAT);
    const commands = new CommandQueue();
    const calls: Array<{ tick: number; player: number }> = [];
    const stub: ComputerModule = {
      id: 'houseBuild',
      run: (_w, ctx, player) => {
        calls.push({ tick: ctx.tick, player });
        return [{ kind: 'marry', entity: STUB_UNIT }];
      },
    };
    for (let tick = 1; tick <= 2 * COMPUTER_DECISION_INTERVAL_TICKS; tick++) {
      runComputerModules(world, ctxAt(tick, commands), [stub]);
    }
    const OTHER_SEAT_SLOT = computerDecisionSlot(OTHER_SEAT);
    expect(calls).toEqual([
      { tick: OTHER_SEAT_SLOT, player: OTHER_SEAT },
      { tick: COMPUTER_DECISION_INTERVAL_TICKS, player: 0 },
      { tick: COMPUTER_DECISION_INTERVAL_TICKS + OTHER_SEAT_SLOT, player: OTHER_SEAT },
      { tick: 2 * COMPUTER_DECISION_INTERVAL_TICKS, player: 0 },
    ]);
    expect(commands.pendingCount).toBe(calls.length); // every returned command was enqueued
  });

  it('gives every player slot a decision slot of its own, evenly spaced around the interval', () => {
    const slots: number[] = [];
    for (let player = 0; player < MAX_PLAYERS; player++) {
      const due = [];
      for (let tick = 0; tick < COMPUTER_DECISION_INTERVAL_TICKS; tick++)
        if (computerDecisionDue(tick, player)) due.push(tick);
      expect(due).toHaveLength(1);
      slots.push(...due);
    }
    slots.sort((a, b) => a - b);
    const gaps = slots.map(
      (slot, i) => (slots[i + 1] ?? COMPUTER_DECISION_INTERVAL_TICKS + (slots[0] ?? 0)) - slot,
    );
    expect(new Set(gaps)).toEqual(new Set([AI_SEAT_SLOT_STEP_TICKS]));
  });

  it('keeps every module tick of the first tiling seats apart from every other seat', () => {
    const firstTilingSeats = COMPUTER_DECISION_INTERVAL_TICKS / (2 * AI_SEAT_SLOT_STEP_TICKS);
    const owner = new Map<number, number>();
    for (let player = 0; player < firstTilingSeats; player++) {
      for (let module = 0; module < COMPUTER_MODULES.length; module++) {
        const tick =
          (computerDecisionSlot(player) + module * COMPUTER_MODULE_PHASE_TICKS) %
          COMPUTER_DECISION_INTERVAL_TICKS;
        expect(owner.get(tick) ?? player).toBe(player);
        owner.set(tick, player);
      }
    }
  });

  it('skips a disabled module for the seat that disabled it and runs it for the rest', () => {
    const world = worldWithSeats(0, OTHER_SEAT); // OTHER_SEAT has `military` disabled
    const commands = new CommandQueue();
    const militaryRuns: number[] = [];
    const houseRuns: number[] = [];
    const military: ComputerModule = {
      id: 'military',
      run: (_w, _c, p) => {
        militaryRuns.push(p);
        return [];
      },
    };
    const house: ComputerModule = {
      id: 'houseBuild',
      run: (_w, _c, p) => {
        houseRuns.push(p);
        return [];
      },
    };
    // Past the tick-0 decision's second module, and one phase past the interval, so the tick-48 decision's
    // second module runs too.
    for (
      let tick = 2 * COMPUTER_MODULE_PHASE_TICKS;
      tick <= COMPUTER_DECISION_INTERVAL_TICKS + COMPUTER_MODULE_PHASE_TICKS;
      tick++
    ) {
      runComputerModules(world, ctxAt(tick, commands), [military, house]);
    }
    expect(militaryRuns).toEqual([0]);
    expect(houseRuns).toEqual([OTHER_SEAT, 0]);
  });

  it("never runs two seats' dear modules on one tick, and at most one light module beside one", () => {
    const world = worldWithSeats(...Array.from({ length: MAX_PLAYERS }, (_, player) => player));
    const commands = new CommandQueue();
    const DEAR: readonly string[] = ['collectResources', 'houseBuild', 'military'];
    const runs: Array<{ tick: number; player: number; module: number }> = [];
    const modules = COMPUTER_MODULES.map(
      (real, module): ComputerModule => ({
        id: real.id,
        run: (_w, ctx, player) => {
          runs.push({ tick: ctx.tick, player, module });
          return [];
        },
      }),
    );
    for (let tick = COMPUTER_DECISION_INTERVAL_TICKS; tick < 2 * COMPUTER_DECISION_INTERVAL_TICKS; tick++) {
      runComputerModules(world, ctxAt(tick, commands), modules);
    }
    // OTHER_SEAT ships its military module disabled.
    expect(runs).toHaveLength(MAX_PLAYERS * modules.length - 1);
    const byTick = new Map<number, string[]>();
    for (const run of runs) {
      const slot = run.tick - run.module * COMPUTER_MODULE_PHASE_TICKS;
      expect(computerDecisionDue(slot, run.player)).toBe(true);
      byTick.set(run.tick, [...(byTick.get(run.tick) ?? []), COMPUTER_MODULES[run.module]?.id ?? '']);
    }
    for (const ids of byTick.values()) {
      expect(ids.filter((id) => DEAR.includes(id)).length).toBeLessThanOrEqual(1);
      expect(ids.filter((id) => !DEAR.includes(id)).length).toBeLessThanOrEqual(1);
    }
  });

  it('re-aims each collector flag once a round of workforce runs, spreading consecutive holders over them', () => {
    const HOLDERS = 2 * FLAG_RELOCATE_EVERY_RUNS;
    const dueByRun: number[] = [];
    for (let run = 0; run < FLAG_RELOCATE_EVERY_RUNS; run++) {
      const tick = run * WORKFORCE_EVERY_DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS;
      const ctx = ctxAt(tick, new CommandQueue());
      let due = 0;
      for (let holder = 0; holder < HOLDERS; holder++) if (flagRelocateDue(ctx, holder as Entity)) due++;
      dueByRun.push(due);
    }
    expect(dueByRun).toEqual(new Array(FLAG_RELOCATE_EVERY_RUNS).fill(2));
  });

  it('runs the workforce on every other decision of a seat, the seats splitting the beats', () => {
    const world = worldWithSeats(0, 1);
    const commands = new CommandQueue();
    const runs: Array<{ decision: number; player: number }> = [];
    const workforce: ComputerModule = {
      id: 'collectResources',
      everyDecisions: WORKFORCE_EVERY_DECISIONS,
      run: (_w, ctx, player) => {
        runs.push({ decision: Math.floor(ctx.tick / COMPUTER_DECISION_INTERVAL_TICKS), player });
        return [];
      },
    };
    const DECISIONS = 4;
    for (let tick = 0; tick < DECISIONS * COMPUTER_DECISION_INTERVAL_TICKS; tick++) {
      runComputerModules(world, ctxAt(tick, commands), [workforce]);
    }
    expect(runs).toEqual([
      { decision: 0, player: 0 },
      { decision: 1, player: 1 },
      { decision: 2, player: 0 },
      { decision: 3, player: 1 },
    ]);
    // The shipped allocator carries the stride the stub stands in for.
    const shipped = COMPUTER_MODULES.find((module) => module.id === 'collectResources');
    expect(shipped?.everyDecisions).toBe(WORKFORCE_EVERY_DECISIONS);
  });

  it('gives a non-flagged player zero AI decisions', () => {
    const world = worldWithSeats(AI_SEAT);
    const commands = new CommandQueue();
    const seen: number[] = [];
    const stub: ComputerModule = {
      id: 'houseBuild',
      run: (_w, _c, p) => {
        seen.push(p);
        return [];
      },
    };
    for (let tick = 1; tick <= 2 * COMPUTER_DECISION_INTERVAL_TICKS; tick++) {
      runComputerModules(world, ctxAt(tick, commands), [stub]);
    }
    expect(seen).toEqual([AI_SEAT, AI_SEAT]); // only the flagged seat, on its two due ticks
  });
});

describe('AI seat determinism and replay', () => {
  const TICKS = 60;

  function liveRun(): Simulation {
    const sim = fresh(7);
    sim.enqueueSetup({ kind: 'setAiControl', player: AI_SEAT, enabled: true, modules: { roadBuild: false } });
    sim.enqueueSetup({ kind: 'spawnSettler', jobType: 1, x: 2, y: 2, tribe: 1, owner: AI_SEAT });
    sim.run(TICKS);
    return sim;
  }

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
