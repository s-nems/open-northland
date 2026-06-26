import type { ContentSet } from '@vinland/data';
import type { Command } from './commands.js';
import { animalRecord } from './systems/readviews/index.js';
import { type CellId, TerrainGraph, type TerrainMap, buildTerrainGraph } from './terrain.js';

/**
 * The **map populator** — seeds a terrain map's wildlife by producing the `spawnAnimalHerd` commands
 * that place each animal tribe's herds at walkable birth points. It is the AnimalSystem/scenario seam
 * the `spawnAnimalHerd` command's doc names: that command *lands* one herd; this decides **which**
 * herds go **where** on a real map, so a loaded map actually contains animals.
 *
 * It is a **pure function**, not a system: given `content` + a `terrain` graph it returns an ordered
 * list of {@link Command}s (all `spawnAnimalHerd`), and a caller (a scenario, the app's map loader)
 * enqueues them through the one mutation seam — exactly like a UI issuing `placeBuilding`. Keeping the
 * populator OUT of the per-tick `SYSTEM_ORDER` is deliberate: seeding happens once, at map load, not
 * every tick, and a pure command-producer is replay-faithful for free (the commands land in the log
 * like any other). The {@link spawnAnimalHerd} command then does the per-herd scatter/leader work.
 *
 * Which tribes: every **recorded animal tribe** in `content.animals` (a `[tribetype]` with an
 * `animaltypes.ini` record), in canonical ascending-`tribeType` order — never a hardcoded list. A
 * civilization (no animal record) is never seeded as wildlife.
 *
 * Where: birth points are chosen by striding through the terrain's **walkable** cells in row-major
 * (canonical) order and taking every `cellStride`-th one, round-robin-assigning successive birth
 * points to successive animal tribes. So herds spread across the map's land instead of clustering, the
 * choice is a pure function of `(content, terrain, options)` — no RNG, no wall-clock — and a map with
 * no walkable cells (all water/blocking) simply seeds nothing.
 *
 * FIDELITY: the **set of animal tribes** (every recorded `[animaltype]`) is faithful, and each herd's
 * size / HP / range / leader come from the verbatim `animaltypes.ini` params (via `spawnAnimalHerd`).
 * **Approximated (no oracle):** *where on the map* each birth point lands and *how many* herds a map
 * gets — the original reads animal birth/spawn points from per-map scenario data (below the readable
 * `.ini`; OpenVikings' sim is a stub), so the even walkable-cell distribution here is a deterministic
 * stand-in, not a pinned placement. Recorded in docs/FIDELITY.md ("Animal map populator").
 */
export interface SeedAnimalsOptions {
  /**
   * Seed only animal tribes whose `tribeType` is in this list (and that have an `animaltypes` record),
   * in canonical ascending order. Omit to seed **every** recorded animal tribe in `content.animals`.
   * A `tribeType` with no animal record is ignored (a civilization can't be wildlife).
   */
  readonly tribes?: readonly number[];
  /**
   * Stride between chosen birth-point cells when walking the walkable cells in row-major order
   * (default 1 = a birth point at every walkable cell, capped by `maxHerds`). A larger stride spreads
   * herds farther apart. Clamped to at least 1.
   */
  readonly cellStride?: number;
  /**
   * Hard cap on the number of herds (commands) emitted, across all tribes (default: one birth point
   * per chosen cell, i.e. as many as the stride yields). Clamped to at least 0; 0 emits nothing.
   */
  readonly maxHerds?: number;
}

/**
 * Seed a map's wildlife: the {@link Command}s that place each animal tribe's herds at walkable birth
 * points. See {@link SeedAnimalsOptions} for the placement rule. Accepts either a built
 * {@link TerrainGraph} or a raw {@link TerrainMap} (which it builds against `content`).
 *
 * Deterministic: a pure function of `(content, terrain, options)` — it walks the terrain's walkable
 * cells in canonical row-major order, assigns birth points round-robin to the canonical-ordered animal
 * tribes, and returns the commands in that order. No RNG, no wall-clock, no world mutation (it touches
 * no entity — the caller enqueues the returned commands, which the CommandSystem applies).
 */
export function seedAnimalHerds(
  content: ContentSet,
  terrain: TerrainGraph | TerrainMap,
  options: SeedAnimalsOptions = {},
): Command[] {
  const graph = terrain instanceof TerrainGraph ? terrain : buildTerrainGraph(content, terrain);

  // The animal tribes to seed: every recorded animal tribe (or the requested subset that HAS a record),
  // in canonical ascending-tribeType order so the round-robin assignment is stable across runs.
  const tribes = resolveAnimalTribes(content, options.tribes);
  if (tribes.length === 0) return []; // no animals in this content — nothing to seed

  // Clamp to sane bounds. A non-finite (NaN) option would otherwise poison the `% stride`/`>= maxHerds`
  // comparisons (every comparison with NaN is false), silently yielding an empty or uncapped result — so
  // a malformed value falls back to the default rather than failing quietly.
  const stride = Number.isFinite(options.cellStride)
    ? Math.max(1, Math.floor(options.cellStride as number))
    : 1;
  const maxHerds = Number.isFinite(options.maxHerds)
    ? Math.max(0, Math.floor(options.maxHerds as number))
    : Number.POSITIVE_INFINITY;
  if (maxHerds === 0) return [];

  const commands: Command[] = [];
  let chosen = 0; // how many walkable cells we have stepped past (drives the stride)
  // Row-major (canonical) walk of every cell; pick every `stride`-th WALKABLE one as a birth point.
  for (let cell = 0 as CellId; cell < graph.cellCount; cell = (cell + 1) as CellId) {
    if (!graph.isWalkable(cell)) continue;
    if (chosen % stride === 0) {
      const { x, y } = graph.coordsOf(cell);
      // Round-robin successive birth points across the animal tribes, so a multi-tribe map gets a
      // mix instead of all of tribe 0 then all of tribe 1. `commands.length` is the birth-point index.
      const tribe = tribes[commands.length % tribes.length] as number;
      commands.push({ kind: 'spawnAnimalHerd', tribe, x, y });
      if (commands.length >= maxHerds) break;
    }
    chosen++;
  }
  return commands;
}

/**
 * The animal tribes to seed, in canonical ascending-`tribeType` order: every recorded animal tribe in
 * `content.animals`, or — when `requested` is given — the subset of `requested` that has an animal
 * record (a `tribeType` with no record is silently dropped, since a civilization can't be wildlife).
 * Deduplicated (the source array may repeat a `tribeType`; `animalRecord` returns the first match).
 */
function resolveAnimalTribes(content: ContentSet, requested?: readonly number[]): number[] {
  const ids = requested ?? content.animals.map((a) => a.tribeType).filter((t) => Number.isInteger(t));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of ids) {
    if (seen.has(t)) continue;
    if (animalRecord(content, t) === null) continue; // not a recorded animal tribe — skip
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}
