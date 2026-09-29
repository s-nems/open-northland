import type { ContentSet } from '@open-northland/data';
import { DEFAULT_FACING, frameOf, type SpriteFrameRef } from '@open-northland/render';
import { systems } from '@open-northland/sim';
import { ANIMAL_BODY_IMAGELIB, ANIMAL_PALETTE_BY_TRIBE, animalBodyStem } from '../catalog/animal-roster.js';
import { animalBinding } from './animal-gfx/bindings.js';
import { sequencesFor } from './ir/joins.js';
import { loadIr } from './ir/load.js';
import type { ContentIr } from './ir/rows.js';
import { fetchJsonOrNull } from './net.js';
import { vehicleAtlasStem, vehicleGraphicsRows, vehicleLook } from './vehicle-gfx/bindings.js';

/**
 * The picture of a good that has no `ls_goods` pile: a vehicle good draws the vehicle standing, a species
 * good the animal standing, each one frame of the served atlas the map draws it from. A vehicle cuts from
 * its baked body, never the indexed one, whose pixels are palette indices.
 *
 * Approximation: the original draws nothing for these. A species good sits on the void landscape type
 * with no `ls_goods` record, and a vehicle good is built on a yard, never shelved.
 */

/** A served atlas manifest's fields an icon reads. */
export interface ServedAtlas {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly {
    readonly bobId: number;
    readonly rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }[];
}

const atlasByStem = new Map<string, Promise<ServedAtlas | null>>();

/** `/bobs/<stem>.atlas.json`, fetched once per page; null when not served. */
export function servedAtlas(stem: string): Promise<ServedAtlas | null> {
  let pending = atlasByStem.get(stem);
  if (pending === undefined) {
    pending = fetchJsonOrNull<ServedAtlas>(`/bobs/${stem}.atlas.json`);
    atlasByStem.set(stem, pending);
  }
  return pending;
}

/** One frame of a served sheet. */
export interface SpriteIconFrame {
  readonly stem: string;
  readonly atlas: ServedAtlas;
  readonly bobId: number;
}

/** The facing an animal is cut at: `0` is SW in the body strip's block order, the near-side view whose
 *  silhouette still reads as the animal once it is shrunk into an icon. */
const ANIMAL_ICON_FACING = 0;

/** A cart that recruits a draught animal is drawn as the harnessed type it becomes: the ox cart's yard
 *  spawns the ox-less cart, and the player ordered the ox cart. */
function finalVehicleType(content: ContentSet, vehicleType: number): number {
  const seen = new Set<number>();
  let current = vehicleType;
  while (!seen.has(current)) {
    seen.add(current);
    const next = content.vehicles.find((v) => v.typeId === current)?.transformVehicleType;
    if (next === undefined) return current;
    current = next;
  }
  return vehicleType;
}

async function vehicleIcon(ir: ContentIr, content: ContentSet, vehicleHouse: number) {
  const spawned = content.buildings.find((b) => b.typeId === vehicleHouse)?.vehicleType;
  if (spawned === undefined) return null;
  const vehicleType = finalVehicleType(content, spawned);
  // The bodies are shared across tribes, so the lowest tribe's row that stands is the picture.
  const rows = vehicleGraphicsRows(ir)
    .filter((row) => row.vehicleType === vehicleType)
    .sort((a, b) => a.tribe - b.tribe);
  for (const row of rows) {
    const stem = vehicleAtlasStem(row);
    const atlas = await servedAtlas(stem);
    if (atlas === null) continue;
    const drawable = new Set(
      atlas.frames.filter((f) => f.rect.width > 0 && f.rect.height > 0).map((f) => f.bobId),
    );
    const look = vehicleLook(row, new Set([stem]), new Map([[stem, drawable]]));
    if (look !== undefined) return { stem, atlas, bobId: frameOf(look.idle, DEFAULT_FACING, 0) };
  }
  return null;
}

async function animalIcon(ir: ContentIr, tribe: number) {
  const palette = ANIMAL_PALETTE_BY_TRIBE.get(tribe);
  const binding = animalBinding(ir, tribe, sequencesFor(ir, ANIMAL_BODY_IMAGELIB));
  if (palette === undefined || binding === null) return null;
  const stem = animalBodyStem(palette);
  const atlas = await servedAtlas(stem);
  const idle: SpriteFrameRef = binding.idle;
  return atlas === null ? null : { stem, atlas, bobId: frameOf(idle, ANIMAL_ICON_FACING, 0) };
}

/** The sprite frame a vehicle or species good draws as its icon; null for any other good, or when the
 *  IR or the atlas is not served. */
export async function spriteGoodIcon(content: ContentSet, goodId: string): Promise<SpriteIconFrame | null> {
  const good = content.goods.find((g) => g.id === goodId);
  if (good === undefined) return null;
  const { vehicleHouse } = good;
  const tribe = systems.livestockTribeOfGood(content, good.typeId);
  if (vehicleHouse === undefined && tribe === null) return null;
  const ir = await loadIr();
  if (ir === null) return null;
  if (vehicleHouse !== undefined) return vehicleIcon(ir, content, vehicleHouse);
  return tribe === null ? null : animalIcon(ir, tribe);
}
