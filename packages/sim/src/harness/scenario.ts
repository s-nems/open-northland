import type { ContentSet } from '@open-northland/data';
import type { Command } from '../core/commands/index.js';
import type { TerrainMap } from '../nav/terrain/index.js';

import { type Simulation, simFor } from '../simulation.js';
import { CORE_INVARIANTS, checkInvariants, type Invariant } from './invariants.js';

/** The outcome of a headless run: the sim it left behind plus every collected failure. */
export interface ScenarioResult {
  readonly sim: Simulation;
  readonly failures: readonly string[];
  readonly invariantViolations: readonly string[];
  /** Chainable, and safe to destructure: the methods close over the run, not over `this`. */
  expect(label: string, predicate: (sim: Simulation) => boolean): ScenarioResult;
  /** Throws with all collected failures. */
  assertOk(): void;
}

export interface RunOptions {
  /** Check after every tick, so a violation names the exact tick a system broke the world. */
  checkInvariantsEachTick?: boolean;
  invariants?: readonly Invariant[];
}

export interface ScenarioOptions {
  /** Fixes the RNG stream. Defaults to 1. */
  seed?: number;
  /** A decoded terrain grid. Omit to run mapless. */
  map?: TerrainMap;
}

class Scenario {
  private readonly sim: Simulation;

  constructor(content: ContentSet, { seed = 1, map }: ScenarioOptions = {}) {
    this.sim = simFor({ content, seed, map });
  }

  /** Authored-setup commands enqueued before `run` apply on the first tick's CommandSystem pass. */
  command(command: Command): this {
    this.sim.enqueueSetup(command);
    return this;
  }

  run(ticks: number, opts: RunOptions = {}): ScenarioResult {
    const invariantViolations: string[] = [];
    const invariants = opts.invariants ?? CORE_INVARIANTS;
    for (let i = 0; i < ticks; i++) {
      this.sim.step();
      if (opts.checkInvariantsEachTick) {
        const v = checkInvariants(this.sim.world, this.sim.content, invariants);
        if (v.length > 0) {
          invariantViolations.push(`tick ${this.sim.tick}: ${v.join('; ')}`);
          break; // the first broken tick is the actionable signal
        }
      }
    }
    if (!opts.checkInvariantsEachTick) {
      invariantViolations.push(...checkInvariants(this.sim.world, this.sim.content, invariants));
    }

    const failures: string[] = [...invariantViolations];
    const sim = this.sim;
    const result: ScenarioResult = {
      sim,
      failures,
      invariantViolations,
      expect(label, predicate) {
        let ok = false;
        try {
          ok = predicate(sim);
        } catch (err) {
          failures.push(`expectation "${label}" threw: ${String(err)}`);
          return result;
        }
        if (!ok) failures.push(`expectation failed: ${label}`);
        return result;
      },
      assertOk() {
        if (failures.length > 0) {
          throw new Error(`scenario failed:\n  - ${failures.join('\n  - ')}`);
        }
      },
    };
    return result;
  }
}

export function scenario(content: ContentSet, opts: ScenarioOptions = {}): Scenario {
  return new Scenario(content, opts);
}
