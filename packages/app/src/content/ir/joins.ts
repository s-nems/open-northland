import {
  type BuildingFootprint,
  fullStateBlockAreaCells,
  type GfxInHouseProgram,
  UNLOADED_GOOD_TYPE,
} from '@open-northland/data';
import type { InHouseProgramLookup } from '@open-northland/render';
import { DOOR_SHIFTS } from '../../catalog/building-tweaks.js';
import { diag } from '../../diag/index.js';
import { canonicalJobType } from '../../game/sandbox/ids/index.js';
import type { GoodRef } from '../settler-gfx/index.js';
import type { BobSeqRow, ContentIr, LandscapeGfxRow } from './rows.js';

/** The served `/bobs/` atlas stem (`<bmd-basename-minus-.bmd>.<palette>`, the pipeline's naming) for a
 *  landscape gfx / building bob record, or `undefined` when it names no body bob or palette. */
export function servedAtlasStem(record: Pick<LandscapeGfxRow, 'bmd' | 'paletteName'>): string | undefined {
  const bmd = record.bmd;
  if (bmd === undefined || bmd.trim() === '') return undefined;
  if (record.paletteName === undefined || record.paletteName.trim() === '') return undefined;
  return `${bmd.slice(bmd.lastIndexOf('/') + 1).replace(/\.bmd$/i, '')}.${record.paletteName}`;
}

/** The `[GfxLandscape]` edit group holding the original's bridges (`landscapes.cif` `EditGroups`). A
 *  name-pinned selector, not a data flag: no extracted lane distinguishes a bridge (`logicType` is `void`
 *  for most records carrying a walk area). `ice bridge` sits in an ice-wall group and is left out by that
 *  same judgement, not by evidence. */
export const BRIDGE_EDIT_GROUP = 'misc_bridges';
const BRIDGE_GROUP_KEY = BRIDGE_EDIT_GROUP.toLowerCase();

/** Whether a landscape record is one of the original's bridges. Matched case-insensitively: the lane
 *  ships mixed-case group names (`xMissionCD_ice wall`, `stones Water`). */
function isBridgeRecord(record: { readonly editGroups?: readonly string[] | undefined }): boolean {
  return record.editGroups?.some((g) => g.toLowerCase() === BRIDGE_GROUP_KEY) === true;
}

/** Whether a record draws as flat ground decor, below every entity: it carries no
 *  `LogicWalkBlockArea`, so it stands on no ground of its own (waves, grass, flowers, mine stains). */
export function drawsAsFlatDecor(record: Pick<LandscapeGfxRow, 'walkBlockAreas'>): boolean {
  return (record.walkBlockAreas ?? []).length === 0;
}

/**
 * The half-cell row a bridge depth-sorts at relative to its own node (the far, lowest-`dy` row of its
 * deck), `undefined` for every other record. Settlers cross a bridge's span, so sorting at the object's
 * own row buries everyone on the far half of it. Approximation: with one sort row for a deck up to 13
 * half-rows long, anything anchored between the far row and the bridge's own row paints over the deck.
 */
export function deckFarRow(
  record: Pick<LandscapeGfxRow, 'walkBlockAreas' | 'editGroups'>,
): number | undefined {
  if (!isBridgeRecord(record)) return undefined;
  const rows = fullStateBlockAreaCells(record.walkBlockAreas).map((c) => c.dy);
  return rows.length === 0 ? undefined : Math.min(...rows);
}

/** The served `/bobs/` stem of a shadow `.bmd`'s atlas (`<shadow-basename-minus-.bmd>.shadow`, the
 *  pipeline's palette-less shadow naming), or `undefined` for an absent/blank reference. */
export function servedShadowStem(shadowBmd: string | undefined): string | undefined {
  if (shadowBmd === undefined || shadowBmd.trim() === '') return undefined;
  return `${shadowBmd.slice(shadowBmd.lastIndexOf('/') + 1).replace(/\.bmd$/i, '')}.shadow`;
}

/**
 * The extracted building ground footprints from the served IR, by typeId. Empty when the IR is absent or
 * carries no footprints. Door cells get the committed per-building `DOOR_SHIFTS` applied here, the one
 * seam that applies them.
 */
export function buildingFootprints(ir: ContentIr | null): Map<number, BuildingFootprint> {
  const out = new Map<number, BuildingFootprint>();
  for (const b of ir?.buildings ?? []) {
    if (b.typeId === undefined || b.footprint === undefined) continue;
    const shift = b.id !== undefined ? DOOR_SHIFTS.get(b.id) : undefined;
    const door = b.footprint.door;
    if (shift !== undefined && door === undefined) {
      // The type still gets its verbatim footprint; the shift is dropped rather than applied blind.
      diag.warn('content', `buildingFootprints: DOOR_SHIFTS['${b.id}'] has no extracted door to shift`);
    }
    out.set(
      b.typeId,
      shift !== undefined && door !== undefined
        ? { ...b.footprint, door: { dx: door.dx + shift.dx, dy: door.dy + shift.dy } }
        : b.footprint,
    );
  }
  return out;
}

/** The `[bobseq]` rows of one imagelib in the served IR, indexed by verbatim sequence name. */
export function sequencesFor(ir: ContentIr | null, imagelib: string): Map<string, BobSeqRow> {
  const byName = new Map<string, BobSeqRow>();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  for (const seq of set?.sequences ?? []) byName.set(seq.name, seq);
  return byName;
}

/** The `gfxanimmode` value marking a body's looping base wait. */
export const GFX_ANIM_MODE_LOOP = 1;

/** One `[gfxanimatomic]` record's playable payload: the per-`<dir>` frame lists plus its `gfxanimmode`. */
export interface GfxAtomicProgram {
  readonly dirFrames: readonly (readonly number[])[];
  readonly mode?: number;
}

/**
 * Every `[gfxanimatomic]` program of one tribe, indexed by action then body bobseq name; first record
 * wins per `(action, seq)`. Filtering by `tribe` matters: the same body bobseq name recurs across the
 * human tribes with different frame lists, so the wrong tribe yields a plausible-but-wrong animation.
 * `tribe` is the `logictribe` (= `logicdefines.inc` `TRIBE_TYPE_*`; viking 1).
 */
export function gfxAtomicProgramsByAction(
  ir: ContentIr | null,
  tribe: number,
): Map<number, Map<string, GfxAtomicProgram>> {
  const byAction = new Map<number, Map<string, GfxAtomicProgram>>();
  for (const row of ir?.gfxAtomics ?? []) {
    if (row.tribe !== tribe) continue;
    let bySeq = byAction.get(row.action);
    if (bySeq === undefined) {
      bySeq = new Map();
      byAction.set(row.action, bySeq);
    }
    if (!bySeq.has(row.bodySeq)) {
      bySeq.set(row.bodySeq, {
        dirFrames: row.dirFrames,
        ...(row.mode !== undefined ? { mode: row.mode } : {}),
      });
    }
  }
  return byAction;
}

/** The wait-atomic ladder (`jobtypes.ini` `allowatomic` 2..7) - the actions a standing body's authored
 *  wait programs sit on. */
const WAIT_ACTIONS = new Set([2, 3, 4, 5, 6, 7]);

/**
 * One tribe's standing-wait program per wait bobseq name. A body authors several wait programs, and the
 * `gfxanimmode 1` one wins because that is the one the original loops between fidgets. A body with no
 * mode-1 record keeps its first program, which a consumer loops as a named approximation.
 */
export function gfxWaitProgramsBySeq(ir: ContentIr | null, tribe: number): Map<string, GfxAtomicProgram> {
  const bySeq = new Map<string, GfxAtomicProgram>();
  const upgradesToBaseWait = (held: GfxAtomicProgram | undefined, mode: number | undefined): boolean =>
    held === undefined || (held.mode !== GFX_ANIM_MODE_LOOP && mode === GFX_ANIM_MODE_LOOP);
  for (const row of ir?.gfxAtomics ?? []) {
    if (row.tribe !== tribe || !WAIT_ACTIONS.has(row.action)) continue;
    if (row.dirFrames.every((list) => list.length === 0)) continue;
    if (!upgradesToBaseWait(bySeq.get(row.bodySeq), row.mode)) continue;
    bySeq.set(row.bodySeq, {
      dirFrames: row.dirFrames,
      ...(row.mode !== undefined ? { mode: row.mode } : {}),
    });
  }
  return bySeq;
}

/**
 * The indoor choreography as the scene asks for it: `(tribe, job, action)` → its `gfxanimmode 2`
 * program, first record winning. `tribe` is the `logictribe` the rows carry, which the sim's tribe
 * typeId matches for the viking (both 1). The job arrives in whichever space the running set uses and is
 * read back into the source's, the space the rows are keyed in.
 *
 * A walk's `goodType` is rewritten from the source's id space into `goods`, the running content set's,
 * because that is the space the carry-gait table is keyed in. Joined by slug, the one id that survives
 * between them; a good the running set does not name draws no load at all.
 */
export function inHouseProgramLookup(ir: ContentIr | null, goods: readonly GoodRef[]): InHouseProgramLookup {
  const runningBySlug = new Map(goods.map((g) => [g.id, g.typeId]));
  const slugBySourceType = new Map((ir?.goods ?? []).map((g) => [g.typeId, g.id]));
  const runningGoodType = (sourceType: number): number => {
    const slug = slugBySourceType.get(sourceType);
    return (slug === undefined ? undefined : runningBySlug.get(slug)) ?? UNLOADED_GOOD_TYPE;
  };
  const byTribe = new Map<number, Map<string, GfxInHouseProgram>>();
  for (const row of ir?.gfxInHousePrograms ?? []) {
    let byJobAction = byTribe.get(row.tribe);
    if (byJobAction === undefined) {
      byJobAction = new Map();
      byTribe.set(row.tribe, byJobAction);
    }
    const key = `${row.job}/${row.action}`;
    if (byJobAction.has(key)) continue;
    byJobAction.set(key, {
      ...row,
      entries: row.entries.map((entry) =>
        entry.kind === 'walk' && entry.goodType !== UNLOADED_GOOD_TYPE
          ? { ...entry, goodType: runningGoodType(entry.goodType) }
          : entry,
      ),
    });
  }
  return (tribe, job, action) => byTribe.get(tribe)?.get(`${canonicalJobType(job)}/${action}`);
}

/** One tribe's `gfxwalkframelist` per-`<dir>` lists, indexed by walk bobseq name (first record wins). */
export function gfxWalkFrameLists(
  ir: ContentIr | null,
  tribe: number,
): Map<string, readonly (readonly number[])[]> {
  const byName = new Map<string, readonly (readonly number[])[]>();
  for (const row of ir?.gfxWalkAtomics ?? []) {
    if (row.tribe !== tribe || row.dirFrames === undefined) continue;
    if (!byName.has(row.bodySeq)) byName.set(row.bodySeq, row.dirFrames);
  }
  return byName;
}

/**
 * The `[gfxwalkatomic]` loaded-gait table for one `(tribe, job)`, as good id-slug → body bobseq name (honey
 * → `human_man_generic_walk_potion`). Keyed by slug, not the source's `logicgoodtype`, because the running
 * content set's `typeId`s are content-relative while slugs are stable. A good with no record for this job
 * stays out of the map - the source's answer that the job shows no load for it.
 */
export function carryWalkSeqs(ir: ContentIr | null, tribe: number, job: number): Map<string, string> {
  const slugByType = new Map((ir?.goods ?? []).map((g) => [g.typeId, g.id]));
  const bySlug = new Map<string, string>();
  for (const row of ir?.gfxWalkAtomics ?? []) {
    if (row.tribe !== tribe || row.job !== job || row.goodType === UNLOADED_GOOD_TYPE) continue;
    const slug = slugByType.get(row.goodType);
    if (slug !== undefined && !bySlug.has(slug)) bySlug.set(slug, row.bodySeq);
  }
  return bySlug;
}
