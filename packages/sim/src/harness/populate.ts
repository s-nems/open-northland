import type { ContentSet } from '@open-northland/data';
import type { Command } from '../core/commands/index.js';
import { buildTerrainGraph, type NodeId, TerrainGraph, type TerrainMap } from '../nav/terrain/index.js';
import { animalRecord } from '../systems/readviews/index.js';

/**
 * Options for the wildlife seeder. The set of animal tribes is faithful: every `[tribetype]` with an
 * `animaltypes.ini` record, and each herd's size, hitpoints, range and leader come from that record.
 * Approximation: birth-point placement and herd count. The original reads them from per-map scenario
 * data below the readable `.ini`, so an even stride across walkable cells stands in for it.
 */
export interface SeedAnimalsOptions {
  /**
   * Restrict seeding to these `tribeType`s. Omit to seed every recorded animal tribe in
   * `content.animals`; a `tribeType` with no animal record is ignored either way.
   */
  readonly tribes?: readonly number[];
  /** Walkable nodes to skip between birth points, clamped to at least 1. Defaults to 1. */
  readonly cellStride?: number;
  /** Cap on emitted herds across all tribes, clamped to at least 0. Defaults to uncapped. */
  readonly maxHerds?: number;
}

/**
 * The `spawnAnimalHerd` commands that place each animal tribe's herds at walkable birth points, for the
 * caller to enqueue. Accepts a built {@link TerrainGraph} or a raw {@link TerrainMap}. Deterministic:
 * walkable nodes are walked in canonical row-major order and birth points go round-robin to the
 * canonically ordered tribes, with no RNG and no world mutation.
 */
export function seedAnimalHerds(
  content: ContentSet,
  terrain: TerrainGraph | TerrainMap,
  options: SeedAnimalsOptions = {},
): Command[] {
  const graph = terrain instanceof TerrainGraph ? terrain : buildTerrainGraph(content, terrain);

  const tribes = resolveAnimalTribes(content, options.tribes);
  if (tribes.length === 0) return [];

  // A NaN option would make every `% stride` and `>= maxHerds` comparison false, so it falls back to
  // the default instead of silently yielding an empty or uncapped result.
  const stride = Number.isFinite(options.cellStride)
    ? Math.max(1, Math.floor(options.cellStride as number))
    : 1;
  const maxHerds = Number.isFinite(options.maxHerds)
    ? Math.max(0, Math.floor(options.maxHerds as number))
    : Number.POSITIVE_INFINITY;
  if (maxHerds === 0) return [];

  const commands: Command[] = [];
  let chosen = 0; // walkable nodes stepped past, which drives the stride
  for (let node = 0 as NodeId; node < graph.nodeCount; node = (node + 1) as NodeId) {
    if (!graph.isWalkable(node)) continue;
    if (chosen % stride === 0) {
      const { x, y } = graph.coordsOf(node);
      // `commands.length` is the birth-point index, so a multi-tribe map gets a mix instead of all of
      // one tribe then all of the next.
      const tribe = tribes[commands.length % tribes.length] as number;
      commands.push({ kind: 'spawnAnimalHerd', tribe, x, y });
      if (commands.length >= maxHerds) break;
    }
    chosen++;
  }
  return commands;
}

/**
 * The animal tribes to seed, deduplicated and in ascending `tribeType` order. A `tribeType` without an
 * animal record is dropped, since a civilization cannot be wildlife, and so is a `hitpoints 0`
 * decorative record whose spawn command places nothing.
 */
function resolveAnimalTribes(content: ContentSet, requested?: readonly number[]): number[] {
  const ids = requested ?? content.animals.map((a) => a.tribeType).filter((t) => Number.isInteger(t));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of ids) {
    if (seen.has(t)) continue;
    const record = animalRecord(content, t);
    if (record === null) continue;
    if (record.hitpointsAdult <= 0) continue; // decorative swarm
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}
