import type { ContentSet } from '@open-northland/data';
import type { Command } from '../core/commands/index.js';
import type { TerrainMap } from '../nav/terrain/index.js';
import { simFor } from '../replay/replay.js';
import type { Simulation } from '../simulation.js';
import { CORE_INVARIANTS, checkInvariants, type Invariant } from './invariants.js';

/**
 * Headless scenario harness — the "e2e at the game level" layer that an AGENT can run and judge by
 * itself, with no screen. A scenario scripts the same serializable commands the UI would issue,
 * runs the deterministic sim for N ticks, and asserts outcomes + invariants. Because the sim is
 * pure and headless, this fully exercises game logic (placement -> AI -> atomics -> economy)
 * end-to-end as a normal `vitest` run. See docs/TESTING.md for the testing pyramid.
 *
 * Example:
 *   const r = scenario(content)
 *     .run(1000, { checkInvariantsEachTick: true })
 *     .expect('settlement produced wood', (sim) => totalGood(sim, WOOD) > 0);
 *   r.assertOk();
 */
export interface ScenarioResult {
  readonly sim: Simulation;
  readonly failures: readonly string[];
  readonly invariantViolations: readonly string[];
  /** Chainable, and safe to destructure — the methods close over the run, not over `this`. */
  expect(label: string, predicate: (sim: Simulation) => boolean): ScenarioResult;
  /** Throws with all collected failures (for use inside a test's it()). */
  assertOk(): void;
}

export interface RunOptions {
  /** Run the invariant checks after every tick (catches the exact tick a system breaks). */
  checkInvariantsEachTick?: boolean;
  invariants?: readonly Invariant[];
}

/**
 * Options for a scenario run. `seed` fixes the RNG (default 1); `map` supplies a real terrain grid —
 * e.g. a `parseTerrainMap`'d `content/maps/<id>.json` — so the sim navigates an actual decoded map in
 * place of a synthetic grid. Omitting `map` runs mapless (the determinism golden does this).
 */
export interface ScenarioOptions {
  seed?: number;
  map?: TerrainMap;
}

class Scenario {
  private readonly sim: Simulation;

  constructor(content: ContentSet, { seed = 1, map }: ScenarioOptions = {}) {
    this.sim = simFor({ content, seed, map });
  }

  /**
   * Script a serializable command exactly as the UI would issue it — the only way to mutate state.
   * Commands enqueued before `run` are applied on the first tick's CommandSystem pass. Chainable.
   */
  command(command: Command): this {
    this.sim.enqueue(command);
    return this;
  }

  run(ticks: number, opts: RunOptions = {}): ScenarioResult {
    const invariantViolations: string[] = [];
    const invariants = opts.invariants ?? CORE_INVARIANTS;
    for (let i = 0; i < ticks; i++) {
      this.sim.step();
      if (opts.checkInvariantsEachTick) {
        const v = checkInvariants(this.sim.world, invariants);
        if (v.length > 0) {
          invariantViolations.push(`tick ${this.sim.tick}: ${v.join('; ')}`);
          break; // stop at first broken tick — that's the actionable signal
        }
      }
    }
    if (!opts.checkInvariantsEachTick) {
      invariantViolations.push(...checkInvariants(this.sim.world, invariants));
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
