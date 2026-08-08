import { type BuildingFootprint, fullStateBlockAreaCells } from '@open-northland/data';
import { DOOR_SHIFTS } from '../../catalog/building-tweaks.js';
import { diag } from '../../diag/index.js';
import type { BobSeqRow, ContentIr, LandscapeGfxRow } from './rows.js';

/** The served `/bobs/` atlas stem (`<bmd-basename-minus-.bmd>.<palette>`, the pipeline's naming) for a
 *  landscape gfx / building bob record, or `undefined` when it names no body bob or palette. The one home
 *  for the `.bmd`→stem convention. */
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

/** Whether a landscape record is one of the original's bridges ({@link BRIDGE_EDIT_GROUP}). Matched
 *  case-insensitively: the lane ships mixed-case group names (`xMissionCD_ice wall`, `stones Water`). */
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
 * carries no footprints. Door cells get the committed per-building {@link DOOR_SHIFTS} applied here, the one
 * seam extracted footprints pass through.
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

/** `gfxanimmode 1` - the record is a body's looping base wait rather than a one-shot motion. */
export const GFX_ANIM_MODE_LOOP = 1;

/** One `[gfxanimatomic]` record's playable payload: the per-`<dir>` frame lists plus its `gfxanimmode`. */
export interface GfxAtomicProgram {
  readonly dirFrames: readonly (readonly number[])[];
  readonly mode?: number;
}

/**
 * Every `[gfxanimatomic]` program of one tribe, indexed by action then body bobseq name. First record
 * wins per `(action, seq)` (a job/action may list several variant seqs; the caller names the one it
 * wants). Filtering by `tribe` matters: the same body bobseq name recurs across the human tribes with
 * different frame lists, so the wrong tribe yields a plausible-but-wrong animation. `tribe` is the
 * `logictribe` (= `logicdefines.inc` `TRIBE_TYPE_*`; viking 1).
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
 * One tribe's standing-wait program per wait bobseq name. A body authors several wait programs (the
 * one-shot fidgets on actions 2..6 and, usually last, the `gfxanimmode 1` looping base wait); the
 * mode-1 program wins, since that is the one the original loops between fidgets. A body with no mode-1
 * record keeps its first program, which a consumer loops as a named approximation.
 */
export function gfxWaitProgramsBySeq(ir: ContentIr | null, tribe: number): Map<string, GfxAtomicProgram> {
  const bySeq = new Map<string, GfxAtomicProgram>();
  for (const row of ir?.gfxAtomics ?? []) {
    if (row.tribe !== tribe || !WAIT_ACTIONS.has(row.action)) continue;
    if (row.dirFrames.every((list) => list.length === 0)) continue;
    const existing = bySeq.get(row.bodySeq);
    if (existing !== undefined && (existing.mode === GFX_ANIM_MODE_LOOP || row.mode !== GFX_ANIM_MODE_LOOP)) {
      continue;
    }
    bySeq.set(row.bodySeq, {
      dirFrames: row.dirFrames,
      ...(row.mode !== undefined ? { mode: row.mode } : {}),
    });
  }
  return bySeq;
}

/**
 * One tribe's `gfxwalkframelist` per-`<dir>` lists, indexed by walk bobseq name (first record wins).
 * A walk list is a contiguous run per direction that may end short of the pool's block stride (the
 * baby crawl plays 12 of each 13-frame block), which the bare `[bobseq]` range cannot encode.
 */
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

/** `logicgoodtype 0` in the `[gfxwalkatomic]` table - the job's unloaded walk, not a carry look. */
const UNLOADED_GOOD_TYPE = 0;

/**
 * The `[gfxwalkatomic]` loaded-gait table for one `(tribe, job)`, as good id-slug → body bobseq name (honey
 * → `human_man_generic_walk_potion`). Keyed by slug, not the source's `logicgoodtype`, because the running
 * content set's `typeId`s are content-relative while slugs are stable. A good with no record for this job is
 * absent from the map, which is the source's answer: that job shows no load for it.
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
