import { BUILDING_KIND, type MapHumanName, type TerrainMapFile } from '@open-northland/data';
import { components, type TerrainMap } from '@open-northland/sim';
import { type AuthoredJoinRows, contentJoins } from './content-joins.js';

function anchorKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/** The authored lanes this join reads; a decoded map's `entities` satisfies it. */
export type AuthoredEntities = Pick<
  NonNullable<TerrainMapFile['entities']>,
  'buildings' | 'humans' | 'animals'
> &
  Partial<Pick<NonNullable<TerrainMapFile['entities']>, 'guides'>>;

/** One resolved authored placement, ready to enqueue. */
export type AuthoredPlacement =
  | { kind: 'signpost'; x: number; y: number; owner: number }
  | {
      kind: 'building';
      typeId: number;
      tribe: number;
      x: number;
      y: number;
      owner?: number;
      /** Authored starting stock (`addgoods`), good names resolved to good typeIds. */
      goods?: { good: number; amount: number }[];
      /** The `sethouse` mission object id, the handle the map's script addresses this house by. */
      missionId?: number;
    }
  | {
      kind: 'human';
      jobType: number;
      tribe: number;
      x: number;
      y: number;
      owner?: number;
      /** The authored produced good (`setproducedgood`), resolved to a good typeId. Only a
       *  flag-harvestable pick reaches a gatherer's flag; the sim drops the rest. */
      gatherGood?: number;
      /** The authored home (`attachtohouse` naming a `home`-kind building), as its anchor half-cell. */
      home?: { x: number; y: number };
      /** The authored workplace (`attachtohouse` naming any other building), as its anchor half-cell. */
      workplace?: { x: number; y: number };
      /** The `sethuman` mission object id, the handle the map's script addresses this settler by. */
      missionId?: number;
      /** The `sethuman` behaviour mask, carried verbatim; no system reads the bits yet. */
      behaviourFlags?: number;
      /** The map's `[misc_humannames]` name for this settler, as a string id in the map's own table. */
      nameStringId?: number;
    }
  | {
      /** One `setanimal` record spawns one creature at its authored half-cell, never a whole
       *  `maximumgroupsize` herd, which would multiply the map's population. */
      kind: 'animal';
      tribe: number;
      x: number;
      y: number;
      /** The `setanimal` player column, absent for the wild slot the corpus writes for game. */
      owner?: number;
      /** The `setanimal` mission object id. */
      missionId?: number;
    };

/**
 * Resolve a map's authored `entities` (names and half-cells, verbatim from `map.cif` `StaticObjects`)
 * into sim placements, joining by name against the IR rows. `sethouse` and `sethuman` player columns are
 * already 0-based, so they land on sim owners verbatim, and half-cells pass through verbatim because the
 * sim grid is the same `2W×2H` lattice the records address. Unresolvable, decorative, or out-of-bounds
 * records are dropped and counted, animals on their own counter.
 *
 * An `attachtohouse` is routed by the kind of the building standing on its anchor, not by its `slot`
 * column. An approximation: reading `slot` itself as the role (1 home, 2 workplace) fits 172 of the 180
 * resolvable rows, and the two readings differ only on six slot-2 homes in one mod map and the two
 * outlier slots. Routing by kind is the safer of the two because no building type both houses and
 * employs. The first entry of each role wins; no corpus human authors two homes or two workplaces.
 */
export function resolveAuthoredPlacements(
  entities: AuthoredEntities,
  rows: AuthoredJoinRows,
  map: TerrainMap,
  humanNames: readonly MapHumanName[] = [],
): {
  placements: AuthoredPlacement[];
  skipped: number;
  droppedGoods: number;
  droppedPicks: number;
  droppedAttachments: number;
  skippedAnimals: number;
} {
  const joins = contentJoins(rows);
  // `map` is the sim's half-cell grid, so authored half-cells bound-check against it directly.
  const inBounds = (hx: number, hy: number): boolean =>
    hx >= 0 && hy >= 0 && hx < map.width && hy < map.height;

  const placements: AuthoredPlacement[] = [];
  let skipped = 0;
  let droppedGoods = 0;
  let droppedPicks = 0;
  let droppedAttachments = 0;
  // The kind of the building placed on each anchor, the key an `attachtohouse` resolves through. Only
  // placed buildings enter it, so an attachment naming a skipped house is dropped with it.
  const kindByAnchor = new Map<string, string>();
  for (const b of entities.buildings) {
    const hit = joins.buildingBob(b.name, b.level);
    if (hit === undefined || !inBounds(b.hx, b.hy)) {
      skipped++;
      continue;
    }
    // A missing good must not cost the map its house, so an unresolvable name is only counted.
    const goods = (b.goods ?? []).flatMap((g) => {
      const good = joins.good(g.name);
      if (good === undefined) {
        droppedGoods++;
        return [];
      }
      return [{ good, amount: g.count }];
    });
    placements.push({
      kind: 'building',
      typeId: hit.typeId,
      tribe: hit.tribeId,
      x: b.hx,
      y: b.hy,
      ...(components.isValidPlayer(b.player) ? { owner: b.player } : {}),
      ...(goods.length > 0 ? { goods } : {}),
      ...(b.missionId !== undefined ? { missionId: b.missionId } : {}),
    });
    // First placement wins, to agree with the sim's lowest-id anchor lookup as long as the sim accepts
    // that placement; no decoded map shares an anchor between two kinds.
    const kind = joins.buildingKind(hit.typeId);
    const key = anchorKey(b.hx, b.hy);
    if (kind !== undefined && !kindByAnchor.has(key)) kindByAnchor.set(key, kind);
  }
  // A `setname` names the first human carrying its id, and a name is spent once given. No corpus map
  // repeats an id; the first row wins here (approximation).
  const nameByHumanId = new Map<number, number>();
  for (const { humanId, stringId } of humanNames) {
    if (!nameByHumanId.has(humanId)) nameByHumanId.set(humanId, stringId);
  }
  for (const h of entities.humans) {
    const jobType = joins.job(h.role);
    const tribe = joins.tribe(h.tribe);
    if (jobType === undefined || tribe === undefined || !inBounds(h.hx, h.hy)) {
      skipped++;
      continue;
    }
    const nameStringId = h.missionId === undefined ? undefined : nameByHumanId.get(h.missionId);
    if (h.missionId !== undefined && nameStringId !== undefined) nameByHumanId.delete(h.missionId);
    // An unresolvable pick only counts: the settler still spawns on the gather-everything default.
    const gatherGood = h.producedGood !== undefined ? joins.good(h.producedGood) : undefined;
    if (h.producedGood !== undefined && gatherGood === undefined) droppedPicks++;
    let home: { x: number; y: number } | undefined;
    let workplace: { x: number; y: number } | undefined;
    for (const a of h.attach ?? []) {
      const kind = kindByAnchor.get(anchorKey(a.hx, a.hy));
      if (kind === undefined) {
        droppedAttachments++;
        continue;
      }
      if (kind === BUILDING_KIND.home) home ??= { x: a.hx, y: a.hy };
      else workplace ??= { x: a.hx, y: a.hy };
    }
    placements.push({
      kind: 'human',
      jobType,
      tribe,
      x: h.hx,
      y: h.hy,
      ...(components.isValidPlayer(h.player) ? { owner: h.player } : {}),
      ...(gatherGood !== undefined ? { gatherGood } : {}),
      ...(home !== undefined ? { home } : {}),
      ...(workplace !== undefined ? { workplace } : {}),
      ...(h.missionId !== undefined ? { missionId: h.missionId } : {}),
      ...(h.behaviourFlags !== undefined ? { behaviourFlags: h.behaviourFlags } : {}),
      ...(nameStringId !== undefined ? { nameStringId } : {}),
    });
  }
  let skippedAnimals = 0;
  // Approximation: `setanimal` also names an animal type the maps decoder drops, so every authored
  // animal spawns adult with `hitpoints_adult`.
  for (const a of entities.animals) {
    const tribe = joins.species(a.species);
    if (tribe === undefined || !inBounds(a.hx, a.hy)) {
      skippedAnimals++;
      continue;
    }
    placements.push({
      kind: 'animal',
      tribe,
      x: a.hx,
      y: a.hy,
      ...(components.isValidPlayer(a.player) ? { owner: a.player } : {}),
      ...(a.missionId !== undefined ? { missionId: a.missionId } : {}),
    });
  }
  for (const guide of entities.guides ?? []) {
    if (!components.isValidPlayer(guide.player) || !inBounds(guide.hx, guide.hy)) {
      skipped++;
      continue;
    }
    placements.push({ kind: 'signpost', x: guide.hx, y: guide.hy, owner: guide.player });
  }
  return { placements, skipped, droppedGoods, droppedPicks, droppedAttachments, skippedAnimals };
}
