import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Component } from '../../src/ecs/world.js';
import { type Command, type LoggedCommand, Simulation, type TerrainMap, replay } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';

/**
 * Tests for `replay()` — the deterministic headless core of the "time-travel / replay inspector" DX
 * win (plan "Cross-cutting DX"). The command log IS the save format, so a recorded run is fully
 * reconstructable from `(content, seed, map?, log)`; `replay()` rebuilds the exact state at any tick
 * by re-applying the log into a fresh sim. The oracle is `hashState()`: a replay to tick N must be
 * byte-identical to the original live run at tick N.
 *
 * Component stores are module-level singletons SHARED across every `Simulation` (AGENTS.md
 * [56e8d3e]) — a replayed sim and the original cannot be alive at once. So each phase here CLEARS the
 * stores before building a new sim, and any value to compare against (a hash STRING, a snapshot
 * value) is captured BEFORE the next sim is built, never read live across the boundary.
 */

const HEADQUARTERS = 1;
const SAWMILL = 2;
const WOODCUTTER = 1;
const CARPENTER = 2;
const VIKING = 1;
const GRASS = 0;

/** Clear every component store (they are shared singletons) so each sim phase starts clean. */
function clearComponentStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as Component<unknown>).store.clear();
    }
  }
}

function grassMap(width: number, height: number): TerrainMap {
  return { resolution: 'half-cell', width, height, typeIds: new Array(width * height).fill(GRASS) };
}

beforeEach(clearComponentStores);

/** Drive a fresh sim through a scripted command schedule and return its log + per-tick hashes. */
function recordRun(
  seed: number,
  ticks: number,
  schedule: ReadonlyMap<number, readonly Command[]>,
  map?: TerrainMap,
): { log: LoggedCommand[]; hashes: string[] } {
  const sim = new Simulation({ seed, content: testContent(), ...(map !== undefined ? { map } : {}) });
  const hashes: string[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    for (const cmd of schedule.get(tick) ?? []) sim.enqueue(cmd);
    sim.step();
    hashes.push(sim.hashState());
  }
  // The log is a plain value (LoggedCommand[]) — safe to keep after the sim's stores are cleared.
  return { log: [...sim.commands.log], hashes };
}

describe('replay', () => {
  it('reconstructs the exact final state of a recorded run (hash-identical)', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING }]],
      // Two commands on the SAME tick — a single Map value (a duplicate Map key drops one) — so the
      // FIFO same-tick apply order is also exercised end to end.
      [
        5,
        [
          { kind: 'placeBuilding', buildingType: SAWMILL, x: 4, y: 0, tribe: VIKING },
          { kind: 'spawnSettler', jobType: CARPENTER, x: 4, y: 0, tribe: VIKING },
        ],
      ],
    ]);
    const { log, hashes } = recordRun(7, 60, schedule, grassMap(6, 1));
    const finalHash = hashes[hashes.length - 1];

    clearComponentStores();
    // The last command applies at tick 5; pass untilTick so replay runs the full 60-tick tail too.
    const reconstructed = replay({
      content: testContent(),
      seed: 7,
      map: grassMap(6, 1),
      log,
      untilTick: 60,
    });

    expect(reconstructed.tick).toBe(60);
    expect(reconstructed.hashState()).toBe(finalHash);
  });

  it('jumps to an intermediate tick: the state matches the live run AT that tick', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 3, y: 0, tribe: VIKING }]],
      [3, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(2, 40, schedule, grassMap(5, 1));

    // Scrub to several ticks; each replay must reproduce the live hash recorded at that exact tick.
    for (const tick of [5, 12, 25, 40]) {
      clearComponentStores();
      const at = replay({ content: testContent(), seed: 2, map: grassMap(5, 1), log, untilTick: tick });
      expect(at.tick).toBe(tick);
      expect(at.hashState()).toBe(hashes[tick - 1]); // hashes[i] is the state after tick i+1
    }
  });

  it('replays a mapless run too (the determinism-golden path: no terrain graph)', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 1, y: 1, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(1, 30, schedule);

    clearComponentStores();
    // Last command at tick 2; untilTick runs the full 30-tick run so the final state matches.
    const reconstructed = replay({ content: testContent(), seed: 1, log, untilTick: 30 });
    expect(reconstructed.hashState()).toBe(hashes[hashes.length - 1]);
  });

  it('an empty log replays to a bare world (default untilTick = 0, no steps)', () => {
    const reconstructed = replay({ content: testContent(), seed: 1, log: [] });
    expect(reconstructed.tick).toBe(0);
    expect(reconstructed.world.entityCount).toBe(0);
  });

  it('untilTick can run PAST the last command (the run continues deterministically)', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(3, 50, schedule, grassMap(4, 1));

    clearComponentStores();
    // Replay to tick 50 even though the last command applied at tick 2 — the sim keeps stepping.
    const reconstructed = replay({
      content: testContent(),
      seed: 3,
      map: grassMap(4, 1),
      log,
      untilTick: 50,
    });
    expect(reconstructed.tick).toBe(50);
    expect(reconstructed.hashState()).toBe(hashes[49]);
  });

  it('scrubs BACKWARD past later commands: tick N matches the live state before they applied', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 0, y: 0, tribe: VIKING }]],
      [10, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(1, 15, schedule);

    clearComponentStores();
    // The whole point of a scrubber: jump to tick 5 — BEFORE the tick-10 command — and get the live
    // state AT tick 5 (the woodcutter not yet present). This is faithful, not a divergence.
    const at5 = replay({ content: testContent(), seed: 1, log, untilTick: 5 });
    expect(at5.tick).toBe(5);
    expect(at5.world.entityCount).toBe(1); // only the HQ — the tick-10 settler isn't replayed yet
    expect(at5.hashState()).toBe(hashes[4]);
  });

  it('throws only on a negative untilTick (a nonsense target)', () => {
    expect(() => replay({ content: testContent(), seed: 1, log: [], untilTick: -1 })).toThrow(/must be >= 0/);
  });

  it('faithfully replays a skipped (recoverable-bad) command that is still in the log', () => {
    const schedule = new Map<number, Command[]>([
      // A tech-gated building with no enabling job is skipped but STILL logged — replay must re-issue
      // it on the same tick so the recoverable-failure path is reproduced bit-for-bit.
      [1, [{ kind: 'placeBuilding', buildingType: 999, x: 0, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(4, 20, schedule);
    expect(log.some((l) => l.command.kind === 'placeBuilding')).toBe(true); // the bad command WAS logged

    clearComponentStores();
    const reconstructed = replay({ content: testContent(), seed: 4, log, untilTick: 20 });
    expect(reconstructed.hashState()).toBe(hashes[hashes.length - 1]);
  });
});
