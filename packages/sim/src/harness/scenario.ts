import type { ContentSet } from '@vinland/data';
import type { Command } from '../core/commands/index.js';
import type { TerrainMap } from '../nav/terrain/index.js';
import { Simulation } from '../simulation.js';
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
  sim: Simulation;
  failures: string[];
  invariantViolations: string[];
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

export class Scenario {
  private readonly sim: Simulation;

  /**
   * @param content the validated content set.
   * @param opts a numeric seed (back-compat) OR a {@link ScenarioOptions} object carrying `seed`/`map`.
   */
  constructor(content: ContentSet, opts: number | ScenarioOptions = {}) {
    const { seed = 1, map } = typeof opts === 'number' ? { seed: opts, map: undefined } : opts;
    // Only attach `map` when present: under exactOptionalPropertyTypes an optional property must be
    // omitted rather than set to undefined (the Simulation builds the terrain graph iff `map` is set).
    this.sim = new Simulation({ seed, content, ...(map !== undefined ? { map } : {}) });
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
    const result: ScenarioResult = {
      sim: this.sim,
      failures,
      invariantViolations,
      expect(label, predicate) {
        let ok = false;
        try {
          ok = predicate(this.sim);
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

export function scenario(content: ContentSet, opts: number | ScenarioOptions = {}): Scenario {
  return new Scenario(content, opts);
}
