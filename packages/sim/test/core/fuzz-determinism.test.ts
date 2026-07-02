import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Component, Entity } from '../../src/ecs/world.js';
import {
  CORE_INVARIANTS,
  type Command,
  type LoggedCommand,
  Rng,
  Simulation,
  type TerrainMap,
  checkInvariants,
  replay,
} from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * COMMAND-STREAM FUZZ — the "desync hunter" the golden tests can't be. The goldens pin ONE curated
 * scenario; nondeterminism and command-validation bugs hide in the input space they never
 * construct. This suite drives the real `step()` schedule with SEEDED-RANDOM command streams —
 * including deliberately INVALID commands (unknown type ids, stale/wrong-kind entity targets,
 * tech-gated placements) — and asserts the three properties every stream must hold:
 *
 *  1. **run-twice determinism** — two live runs from the same seeds are byte-identical, checked at
 *     hash checkpoints through the run (not just the end, so a divergence names its window);
 *  2. **replay fidelity** — replaying the recorded command log reproduces the live run's final hash
 *     (the log really IS the save format, for arbitrary streams, skipped-bad-commands included);
 *  3. **invariants + cache coherence every tick** — no stream may drive the world into an invalid
 *     state, and every incrementally-maintained cache re-derives clean (`cachesCoherent`).
 *
 * Invalid commands are IN the stream on purpose: in lockstep any peer can send anything, and a
 * command's target can die between issue and apply — rejection must happen at EXECUTION time,
 * deterministically and identically on every peer, so the fuzzer exercises the skip paths as
 * first-class inputs.
 *
 * The generator is a pure function of its OWN Rng (never of world state): both live runs and the
 * replay see byte-identical streams by construction, and a failure reproduces from the fuzz seed.
 */

const GRASS = 0;
const VIKING = 1;
/** A type id absent from every fixture table — the unknown-id skip path. */
const INVALID_TYPE = 99;
/** Building types: HQ / sawmill / temple / tech-gated smithy / unknown (fixtures/content.ts). */
const BUILDING_TYPES = [1, 2, 3, 4, INVALID_TYPE] as const;
/** Job types: idle / woodcutter / carpenter / hunter / carrier / unknown. */
const JOB_TYPES = [0, 1, 2, 15, 36, INVALID_TYPE] as const;
/** Herd tribes: bear pack / bee / boar / cow / deer, plus two non-animals (viking, unknown) — skipped. */
const HERD_TRIBES = [10, 11, 12, 13, 14, VIKING, INVALID_TYPE] as const;
/** The viking woodcutter's weapon (test_axe) and leather armor — the combatant-spawn extras. */
const AXE = 7;
const LEATHER = 1;
const COMBATANT_HITPOINTS = 500;
/** Entity-targeting commands draw ids from [1, TARGET_ID_RANGE] — live, dead, and never-created. */
const TARGET_ID_RANGE = 80;
/** ~1 command every this-many ticks keeps the stream busy without swamping the map. */
const COMMAND_EVERY = 4;
/** Hash checkpoint cadence — a run-twice divergence is localized to a 50-tick window. */
const CHECKPOINT_EVERY = 50;

const MAP_W = 12;
const MAP_H = 12;
const FUZZ_SEEDS = [11, 29, 47] as const;
const TICKS = 300;

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/** Clear every component store (module-level singletons) so runs can't leak into each other. */
function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as Component<unknown>).store.clear();
    }
  }
}

function pick<T>(rng: Rng, options: readonly T[]): T {
  const v = options[rng.int(options.length)];
  if (v === undefined) throw new Error('pick from empty options');
  return v;
}

/** One random command — a pure function of `rng` alone (NEVER world state; see the module doc). */
function nextCommand(rng: Rng): Command {
  const x = rng.int(MAP_W);
  const y = rng.int(MAP_H);
  const roll = rng.int(6);
  switch (roll) {
    case 0:
      return {
        kind: 'placeBuilding',
        buildingType: pick(rng, BUILDING_TYPES),
        x,
        y,
        tribe: VIKING,
        ...(rng.int(3) === 0 ? { underConstruction: true } : {}),
      };
    case 1: {
      // Every third settler is a combatant (Health + armor + a specific weapon + a walk pace) so the
      // fuzz reaches the combat/movement stamps, not just the economy.
      const combatant = rng.int(3) === 0;
      return {
        kind: 'spawnSettler',
        jobType: pick(rng, JOB_TYPES),
        x,
        y,
        tribe: VIKING,
        ...(combatant
          ? { hitpoints: COMBATANT_HITPOINTS, armorClass: LEATHER, weaponTypeId: AXE, moveSpeed: 4 }
          : {}),
      };
    }
    case 2:
      return { kind: 'spawnAnimalHerd', tribe: pick(rng, HERD_TRIBES), x, y };
    case 3:
      // The fixture ships no vehicles, so EVERY placeBoat is the skipped-but-logged path — replay
      // must reproduce the same state through a log full of no-op commands.
      return { kind: 'placeBoat', vehicleType: pick(rng, [1, INVALID_TYPE]), x, y, tribe: VIKING };
    case 4:
      return {
        kind: 'setProduction',
        building: (rng.int(TARGET_ID_RANGE) + 1) as Entity,
        goodType: rng.int(4),
      };
    default:
      // Random target ids hit live buildings, live NON-buildings (settlers, herds — must be
      // skipped), dead entities, and ids never created. All four must resolve deterministically.
      return { kind: 'demolish', building: (rng.int(TARGET_ID_RANGE) + 1) as Entity };
  }
}

interface FuzzRun {
  readonly finalHash: string;
  /** `hashState()` at every CHECKPOINT_EVERY-th tick — localizes a run-twice divergence. */
  readonly checkpoints: readonly string[];
  readonly violations: readonly string[];
  readonly log: readonly LoggedCommand[];
}

function runFuzz(fuzzSeed: number, ticks: number): FuzzRun {
  clearStores();
  const sim = new Simulation({ seed: fuzzSeed, content: testContent(), map: grassMap(MAP_W, MAP_H) });
  // An independent generator stream (any fixed derivation of the fuzz seed works — it only must
  // differ from the sim's seed so the two streams aren't trivially correlated).
  const gen = new Rng(fuzzSeed ^ 0x5eed);
  const checkpoints: string[] = [];
  const violations: string[] = [];
  for (let t = 0; t < ticks; t++) {
    if (gen.int(COMMAND_EVERY) === 0) sim.enqueue(nextCommand(gen));
    sim.step();
    if (violations.length === 0) {
      const v = checkInvariants(sim.world, CORE_INVARIANTS);
      if (v.length > 0) violations.push(`tick ${sim.tick}: ${v.join('; ')}`);
    }
    if (sim.tick % CHECKPOINT_EVERY === 0) checkpoints.push(sim.hashState());
  }
  // The log is plain data owned by this sim instance — copy the array so it outlives store reuse.
  return { finalHash: sim.hashState(), checkpoints, violations, log: [...sim.commands.log] };
}

describe('fuzz: randomized command streams stay deterministic, replayable, and invariant-clean', () => {
  for (const seed of FUZZ_SEEDS) {
    it(`seed ${seed}: two live runs are byte-identical and invariant-clean`, () => {
      const a = runFuzz(seed, TICKS);
      const b = runFuzz(seed, TICKS);
      expect(a.violations).toEqual([]);
      expect(b.violations).toEqual([]);
      // Checkpoint-wise equality first: on a divergence the failing index names the 50-tick window.
      expect(b.checkpoints).toEqual(a.checkpoints);
      expect(b.finalHash).toBe(a.finalHash);
    });

    it(`seed ${seed}: replaying the recorded log reproduces the final state`, () => {
      const live = runFuzz(seed, TICKS);
      expect(live.log.length).toBeGreaterThan(0); // the stream actually exercised the command seam
      clearStores(); // replay() rebuilds in the shared stores — the live sim is superseded
      const replayed = replay({
        content: testContent(),
        seed,
        map: grassMap(MAP_W, MAP_H),
        log: live.log,
        untilTick: TICKS, // run the full recorded duration, incl. ticks after the last command
      });
      expect(replayed.hashState()).toBe(live.finalHash);
    });
  }
});
