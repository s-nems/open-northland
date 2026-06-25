import type { ContentSet } from '@vinland/data';
import type { Command } from './commands.js';
import { Simulation } from './index.js';
import { CORE_INVARIANTS, type Invariant, checkInvariants } from './invariants.js';

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

export class Scenario {
  private readonly sim: Simulation;

  constructor(content: ContentSet, seed = 1) {
    this.sim = new Simulation({ seed, content });
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

export function scenario(content: ContentSet, seed = 1): Scenario {
  return new Scenario(content, seed);
}
