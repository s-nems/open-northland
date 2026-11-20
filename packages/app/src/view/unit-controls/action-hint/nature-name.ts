import type { ContentSet } from '@open-northland/data';
import { type ChestKind, entityById, type WorldSnapshot } from '@open-northland/sim';
import type { UiString } from '../../../content/gui/gfx.js';
import { chestKindOf, type SnapshotEntity, settlerTribeOf } from '../../../game/snapshot/index.js';
import { messages, tribeName } from '../../../i18n/index.js';
import { contentLookups } from '../right-click/context.js';
import type { PointHits } from '../unit-targets.js';
import { countedLabel, goodLabel } from './counted-label.js';
import type { HintTarget, PlanHint } from './plan-hint.js';

/** The `misc` rows naming the two chest kinds. */
const CHEST_NAME_STRING_ID: Readonly<Record<ChestKind, number>> = { wooden: 112, magical: 113 };

/** The `misc` rows naming a landscape resource, by the slug of the good it yields. */
const RESOURCE_NAME_STRING_ID: ReadonlyMap<string, number> = new Map([
  ['wood', 100],
  ['fruit', 101],
  ['mud', 102],
  ['stone', 103],
  ['iron', 104],
  ['gold', 105],
  ['wheat', 106],
  ['herb', 107],
  ['mushroom', 108],
]);

export interface NatureNameContext {
  readonly snapshot: WorldSnapshot;
  readonly content: ContentSet;
  readonly uiString: UiString;
  /** An observer's line for what a closed chest holds; absent for a player, to whom it stays a surprise. */
  readonly chestContents?: (chest: SnapshotEntity) => string | null;
}

/**
 * The nature thing the label names: the one the main order aims at, else the frontmost animal, goods
 * heap, chest or resource under the cursor. Nothing over a settler, vehicle, building or site, whose
 * card names it.
 */
export function natureTargetOf(hit: PointHits, hint: PlanHint | null): HintTarget | null {
  if (hint?.tone === 'action' && hint.target !== null) return hint.target;
  if (
    hit.ownSettler !== null ||
    hit.ownVehicle !== null ||
    hit.building !== null ||
    hit.site !== null ||
    hit.enemy !== null
  )
    return null;
  if (hit.creature !== null) return { kind: 'creature', ref: hit.creature };
  if (hit.pile !== null) return { kind: 'pile', ref: hit.pile.ref };
  if (hit.chest !== null) return { kind: 'chest', ref: hit.chest };
  if (hit.resource !== null) return { kind: 'resource', ref: hit.resource.ref };
  return null;
}

/** The localized name of `target`, read off the hit it came from; null when it left the world. */
export function natureName(ctx: NatureNameContext, target: HintTarget, hit: PointHits): string | null {
  switch (target.kind) {
    case 'creature': {
      const entity = entityById(ctx.snapshot, target.ref);
      const tribe = entity === undefined ? undefined : settlerTribeOf(entity);
      if (tribe === undefined) return null;
      const animal = ctx.content.animals.find((row) => row.tribeType === tribe);
      return tribeName(tribe, animal?.name ?? animal?.id);
    }
    case 'pile': {
      const pile = hit.pile;
      if (pile === null) return null;
      return countedLabel(goodLabel(ctx.content, pile.goodType), pile.amount);
    }
    case 'chest': {
      const entity = entityById(ctx.snapshot, target.ref);
      const kind = entity === undefined ? undefined : chestKindOf(entity);
      if (entity === undefined || kind === undefined) return null;
      const name = ctx.uiString('misc', CHEST_NAME_STRING_ID[kind], messages().hud.chest[kind]);
      const held = ctx.chestContents?.(entity) ?? null;
      return held === null ? name : `${name} · ${held}`;
    }
    case 'resource': {
      const resource = hit.resource;
      if (resource === null) return null;
      const slug = contentLookups(ctx.content).goods.get(resource.goodType)?.id;
      const row = slug === undefined ? undefined : RESOURCE_NAME_STRING_ID.get(slug);
      const fallback = goodLabel(ctx.content, resource.goodType);
      return row === undefined ? fallback : ctx.uiString('misc', row, fallback);
    }
  }
}
