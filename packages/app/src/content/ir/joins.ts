import { type BuildingFootprint, fullStateBlockAreaCells } from '@open-northland/data';
import { DOOR_SHIFTS } from '../../catalog/building-tweaks.js';
import { diag } from '../../diag/index.js';
import type { BobSeqRow, ContentIr, GfxAnimAtomicRow, LandscapeGfxRow } from './rows.js';

/** The served `/bobs/` atlas stem (`<bmd-basename-minus-.bmd>.<palette>`, the pipeline's naming) for a
 *  landscape gfx / building bob record, or `undefined` when it names no body bob or palette (a pure-logic
 *  record with no drawable atlas). The one home for the `.bmd`→stem convention the gathering-ref,
 *  map-object and shadow joins share. */
export function servedAtlasStem(record: Pick<LandscapeGfxRow, 'bmd' | 'paletteName'>): string | undefined {
  const bmd = record.bmd;
  if (bmd === undefined || bmd.trim() === '') return undefined;
  if (record.paletteName === undefined || record.paletteName.trim() === '') return undefined;
  return `${bmd.slice(bmd.lastIndexOf('/') + 1).replace(/\.bmd$/i, '')}.${record.paletteName}`;
}

/** The `[GfxLandscape]` edit group holding the original's bridges (`landscapes.cif` `EditGroups`).
 *  Exported so the real-IR invariant pins the same join key the collision and draw joins read. */
export const BRIDGE_EDIT_GROUP = 'misc_bridges';

/** Whether a landscape record is one of the original's bridges ({@link BRIDGE_EDIT_GROUP}). */
export function isBridgeRecord(record: { readonly editGroups?: readonly string[] | undefined }): boolean {
  return record.editGroups?.includes(BRIDGE_EDIT_GROUP) === true;
}

/** Whether a record draws as flat ground decor, below every entity: it carries no
 *  `LogicWalkBlockArea`, so it stands on no ground of its own (waves, grass, flowers, mine stains). */
export function drawsAsFlatDecor(record: Pick<LandscapeGfxRow, 'walkBlockAreas'>): boolean {
  return (record.walkBlockAreas ?? []).length === 0;
}

/**
 * The half-cell row a bridge depth-sorts at relative to its own node (the far, lowest-`dy` row of its
 * deck), `undefined` for every other record. Settlers cross ON a bridge deck (`content/collision.ts`
 * holds why), so sorting at the object's own row buries everyone on the far half of the span.
 *
 * One sort row for a deck up to 13 half-rows long is an approximation: an object standing between the
 * far row and the bridge's own row paints over the deck. No placement in the owned corpus does.
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
 * The extracted building ground footprints from the served IR, by typeId — the collision/build-exclusion
 * data live content attaches so the real-content view (`?map=`) enforces and shows placement collision
 * (scenes and bare checkouts stay footprint-less, keeping free placement). Empty when the IR is absent or
 * carries no footprints. Door cells get the committed per-building {@link DOOR_SHIFTS} applied here — the
 * one seam extracted footprints pass through — so the sim's walk-to-door target and the `?debug=geometry`
 * overlay read the same corrected door.
 */
export function buildingFootprints(ir: ContentIr | null): Map<number, BuildingFootprint> {
  const out = new Map<number, BuildingFootprint>();
  for (const b of ir?.buildings ?? []) {
    if (b.typeId === undefined || b.footprint === undefined) continue;
    const shift = b.id !== undefined ? DOOR_SHIFTS.get(b.id) : undefined;
    const door = b.footprint.door;
    if (shift !== undefined && door === undefined) {
      // A committed correction with nothing to correct — a re-extraction dropped the door. Warn so the
      // review-signed shift isn't silently lost (the type still gets its verbatim footprint).
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

/**
 * The `[gfxanimatomic]` per-direction frame lists for one `(tribe, action)`, indexed by body bobseq name
 * — the directional action layout a bare bobseq range can't encode ({@link GfxAnimAtomicRow.dirFrames}).
 * First record wins per seq (a job/action may list several variant seqs — the unarmed soldier's four
 * punches; the caller names the one it wants). Filtering by `tribe` matters: the same body bobseq name
 * recurs across the human tribes with different frame lists (each tribe's own swing layout), so passing
 * the wrong tribe yields a plausible-but-wrong animation. `tribe` is the `[gfxanimatomic]` `logictribe`
 * (= the `logicdefines.inc` `TRIBE_TYPE_*`; viking 1).
 */
export function gfxAtomicFrameLists(
  ir: ContentIr | null,
  tribe: number,
  action: number,
): Map<string, readonly (readonly number[])[]> {
  const byName = new Map<string, readonly (readonly number[])[]>();
  for (const row of ir?.gfxAtomics ?? []) {
    if (row.tribe !== tribe || row.action !== action) continue;
    if (!byName.has(row.bodySeq)) byName.set(row.bodySeq, row.dirFrames);
  }
  return byName;
}

/** `logicgoodtype 0` in the `[gfxwalkatomic]` table — the job's unloaded walk, not a carry look. */
const UNLOADED_GOOD_TYPE = 0;

/**
 * The `[gfxwalkatomic]` loaded-gait table for one `(tribe, job)`, as **good id-slug → body bobseq name**
 * — the original's own answer to "which cycle does a settler play hauling this good" (honey →
 * `human_man_generic_walk_potion`). Keyed by slug, not the source's `logicgoodtype`, because the running
 * content set's `typeId`s are content-relative (the sandbox's honey is not the decoded IR's honey) while
 * slugs are stable; {@link import('../settler-gfx/index.js').carryAnimsByGood} does the slug → running
 * `typeId` half.
 *
 * The unloaded walk (`logicgoodtype 0`) is dropped — that is the job's plain gait, not a carry look. A
 * good with no record for this job is absent from the map, which is itself the source's answer: that job
 * shows no load for it (a soldier binds its empty walk for every good, and a woman only hauls the nine
 * goods her body authors).
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
