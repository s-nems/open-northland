import { beforeEach, describe, expect, it } from 'vitest';
import * as components from '../src/components/index.js';
import type { Component } from '../src/ecs/world.js';
import {
  type Command,
  type LoggedCommand,
  Simulation,
  type TerrainMap,
  rebaseContent,
  replay,
} from '../src/index.js';
import { testContent } from './fixtures/content.js';

/**
 * Tests for `rebaseContent()` — the headless, self-verifiable half of the "Content hot-reload" DX win
 * (ROADMAP "Cross-cutting DX"). The app reads/watches a content file (Vite-HMR glue, render-side);
 * this validates the new raw blob and, if valid, REBASES the run onto it by replaying the command log
 * into a fresh sim built with the NEW content. Two oracles: (1) rebasing onto the SAME content
 * reproduces the run byte-for-byte (`hashState()` — inherited from `replay`); (2) rebasing onto
 * CHANGED content reaches a state the changed data dictates, NOT the old one.
 *
 * Component stores are module-level singletons SHARED across every `Simulation` (docs/LESSONS.md
 * [56e8d3e]) — a rebased sim supersedes the original. So each phase CLEARS the stores before building
 * a new sim, and any value compared across the boundary (a hash STRING) is captured BEFORE the rebuild.
 */

const HEADQUARTERS = 1;
const SAWMILL = 2;
const WOODCUTTER = 1;
const CARPENTER = 2;
const VIKING = 1;
const GRASS = 0;

function clearStores(): void {
  for (const c of Object.values(components)) {
    if (typeof c === 'object' && c !== null && 'store' in c) {
      (c as Component<unknown>).store.clear();
    }
  }
}

function grassMap(width: number, height: number): TerrainMap {
  return { width, height, typeIds: new Array(width * height).fill(GRASS) };
}

/**
 * A RAW content blob (a plain object), the shape the app would read off disk and hand to
 * `rebaseContent`. A parsed `ContentSet` is plain JSON-serializable data, so a deep clone of the
 * test fixture IS a valid raw blob — re-parsing it is a no-op round-trip. `mutate` lets a test tweak
 * one balance param so the rebase's effect is observable.
 */
function rawContent(mutate?: (c: ReturnType<typeof testContent>) => void): unknown {
  const blob = structuredClone(testContent());
  mutate?.(blob);
  return blob;
}

beforeEach(clearStores);

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
  return { log: [...sim.commands.log], hashes };
}

describe('rebaseContent', () => {
  it('rebasing onto IDENTICAL content reproduces the run byte-for-byte', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING }]],
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

    clearStores();
    const result = rebaseContent(rawContent(), {
      seed: 7,
      map: grassMap(6, 1),
      log,
      untilTick: 60,
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.sim.tick).toBe(60);
    // The rebase's determinism oracle: same content + same log ⇒ the original run, bit-for-bit.
    expect(result.sim.hashState()).toBe(finalHash);
  });

  it('rebasing onto CHANGED content reaches a state the new data dictates, not the old', () => {
    // The HQ seeds its starting wood from content (`stock[].initial`, read at placeBuilding time).
    // Bumping that initial (10→42) is a balance edit whose effect is directly observable: the rebased
    // run's placed HQ holds the NEW amount, so its state at the same tick must DIFFER from the original.
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(7, 60, schedule, grassMap(6, 1));
    const originalFinal = hashes[hashes.length - 1];

    clearStores();
    const tweaked = rebaseContent(
      rawContent((c) => {
        const hq = c.buildings.find((b) => b.id === 'headquarters');
        const woodSlot = hq?.stock.find((s) => s.goodType === 1);
        if (woodSlot) woodSlot.initial = 42; // a balance edit: more starting wood
      }),
      { seed: 7, map: grassMap(6, 1), log, untilTick: 60 },
    );

    expect(tweaked.kind).toBe('ok');
    if (tweaked.kind !== 'ok') return;
    expect(tweaked.sim.tick).toBe(60);
    // Different rules ⇒ a different reachable state at the same tick: the rebase actually applied.
    expect(tweaked.sim.hashState()).not.toBe(originalFinal);
    // And the new content is what the rebased sim now carries.
    expect(
      tweaked.content.buildings.find((b) => b.id === 'headquarters')?.stock.find((s) => s.goodType === 1)
        ?.initial,
    ).toBe(42);
  });

  it('rebasing the CHANGED content back to the ORIGINAL content restores the original state', () => {
    // Round-trip: a rebase is a pure function of (content, seed, map, log), so re-rebasing the same
    // log onto the original content lands exactly the original state — the hot-reload is reversible.
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING }]],
      [3, [{ kind: 'spawnSettler', jobType: CARPENTER, x: 3, y: 0, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(7, 80, schedule, grassMap(6, 1));
    const originalFinal = hashes[hashes.length - 1];

    clearStores();
    rebaseContent(
      rawContent((c) => {
        const sawmill = c.buildings.find((b) => b.id === 'sawmill');
        if (sawmill?.recipe) sawmill.recipe.ticks = 10;
      }),
      { seed: 7, map: grassMap(6, 1), log, untilTick: 80 },
    );

    clearStores();
    const back = rebaseContent(rawContent(), { seed: 7, map: grassMap(6, 1), log, untilTick: 80 });
    expect(back.kind).toBe('ok');
    if (back.kind !== 'ok') return;
    expect(back.sim.hashState()).toBe(originalFinal);
  });

  it('a rebased sim re-logs the command history, so a SECOND reload chains off the first', () => {
    // The documented hot-reload workflow is REPEATED: a designer edits, then edits AGAIN. For the
    // second `rebaseContent` to carry the run forward, the first rebase's sim must expose the SAME
    // command log it was rebased from — replay re-applies each command through CommandSystem, which
    // re-records it (commands.ts `record`), so `rebased.commands.log` reproduces the input log. If it
    // didn't, the next reload would replay an empty/partial log and silently drop the player's history
    // — a diff-empty correctness trap the workflow lives or dies on. This pins that chain.
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 5, y: 0, tribe: VIKING }]],
      [2, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 1, y: 0, tribe: VIKING }]],
      [5, [{ kind: 'spawnSettler', jobType: CARPENTER, x: 4, y: 0, tribe: VIKING }]],
    ]);
    const { log, hashes } = recordRun(7, 60, schedule, grassMap(6, 1));
    const finalHash = hashes[hashes.length - 1];

    // First reload (a balance edit), rebased from the live run's log.
    clearStores();
    const first = rebaseContent(
      rawContent((c) => {
        const sawmill = c.buildings.find((b) => b.id === 'sawmill');
        if (sawmill?.recipe) sawmill.recipe.ticks = 11;
      }),
      { seed: 7, map: grassMap(6, 1), log, untilTick: 60 },
    );
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    // The rebased sim must carry the WHOLE history forward — its log equals the input log byte-for-byte
    // (CommandSystem re-records each replayed command on the same apply tick). Captured as a plain
    // array before the next rebuild clobbers the shared stores.
    const rebasedLog = [...first.sim.commands.log];
    expect(rebasedLog).toEqual(log);

    // Second reload: edit AGAIN, rebasing off the FIRST rebased sim's log (the chain). Back to the
    // ORIGINAL rules ⇒ the original state, proving the history survived the first rebase intact.
    clearStores();
    const second = rebaseContent(rawContent(), {
      seed: 7,
      map: grassMap(6, 1),
      log: rebasedLog,
      untilTick: 60,
    });
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') return;
    expect(second.sim.tick).toBe(60);
    expect(second.sim.hashState()).toBe(finalHash);
  });

  it('returns a typed error on MALFORMED content (schema failure) — no sim is built', () => {
    const result = rebaseContent(
      rawContent((c) => {
        // Break the schema: a good's typeId must be a number.
        (c.goods[0] as unknown as { typeId: unknown }).typeId = 'not-a-number';
      }),
      { seed: 1, log: [] },
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('returns a typed error on a CROSS-REFERENCE failure (dangling id) — not a throw', () => {
    const result = rebaseContent(
      rawContent((c) => {
        // A building worker pointing at a job that doesn't exist trips validateCrossReferences.
        const hq = c.buildings.find((b) => b.id === 'headquarters');
        if (hq) hq.workers = [{ jobType: 9999, count: 1 }];
      }),
      { seed: 1, log: [] },
    );
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') return;
    expect(result.message).toMatch(/unknown jobType 9999/);
  });

  it('a malformed reload does NOT disturb a live sim (the error path builds nothing)', () => {
    // A live run exists; a bad reload arrives. The original sim must keep working: rebaseContent
    // returns `error` WITHOUT touching the shared stores, so the live sim's state is unchanged.
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(4, 1) });
    sim.enqueue({ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 0, tribe: VIKING });
    sim.run(10);
    const before = sim.hashState();

    const result = rebaseContent(
      rawContent((c) => {
        (c.goods[0] as unknown as { typeId: unknown }).typeId = 'broken';
      }),
      { seed: 5, map: grassMap(4, 1), log: [...sim.commands.log], untilTick: 10 },
    );
    expect(result.kind).toBe('error');
    // The live sim is untouched — same hash, still steppable.
    expect(sim.hashState()).toBe(before);
    sim.step();
    expect(sim.tick).toBe(11);
  });

  it('defaults untilTick to the last logged tick, like replay', () => {
    const schedule = new Map<number, Command[]>([
      [1, [{ kind: 'placeBuilding', buildingType: HEADQUARTERS, x: 2, y: 0, tribe: VIKING }]],
      [4, [{ kind: 'spawnSettler', jobType: WOODCUTTER, x: 0, y: 0, tribe: VIKING }]],
    ]);
    const { log } = recordRun(3, 20, schedule, grassMap(4, 1));

    clearStores();
    const result = rebaseContent(rawContent(), { seed: 3, map: grassMap(4, 1), log });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // The last command applied at tick 4, so the default rebase lands at tick 4 (replay's default).
    expect(result.sim.tick).toBe(4);

    // Identical to an explicit replay to the same tick (rebaseContent IS replay + validation).
    // Capture each hash as a plain string BEFORE the next sim clobbers the shared stores.
    clearStores();
    const direct = replay({ content: testContent(), seed: 3, map: grassMap(4, 1), log, untilTick: 4 });
    const directHash = direct.hashState();
    clearStores();
    const viaRebase = rebaseContent(rawContent(), { seed: 3, map: grassMap(4, 1), log });
    expect(viaRebase.kind).toBe('ok');
    if (viaRebase.kind !== 'ok') return;
    expect(viaRebase.sim.hashState()).toBe(directHash);
  });
});
