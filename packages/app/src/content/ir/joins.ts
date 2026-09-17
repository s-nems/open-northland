import {
  type BuildingFootprint,
  fullStateBlockAreaCells,
  type GfxInHouseProgram,
  UNLOADED_GOOD_TYPE,
} from '@open-northland/data';
import type { HolyFireLookup, InHouseProgramLookup, SpriteAtlas } from '@open-northland/render';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
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

/** The `landscapeGfx` rows by `EditName`, the key a map's `objects` lane joins on; the first row of a
 *  repeated name wins. */
export function landscapeRecordsByName(ir: ContentIr): ReadonlyMap<string, LandscapeGfxRow> {
  const byName = new Map<string, LandscapeGfxRow>();
  for (const row of ir.landscapeGfx ?? []) {
    if (row.editName !== undefined && !byName.has(row.editName)) byName.set(row.editName, row);
  }
  return byName;
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

/** The extracted building ground footprints from the served IR, by typeId; empty when the IR is absent or
 *  carries no footprints. */
export function buildingFootprints(ir: ContentIr | null): Map<number, BuildingFootprint> {
  const out = new Map<number, BuildingFootprint>();
  for (const b of ir?.buildings ?? []) {
    if (b.typeId !== undefined && b.footprint !== undefined) out.set(b.typeId, b.footprint);
  }
  return out;
}

/**
 * The served body-atlas stem → shadow-atlas stem join, from every IR row pairing a body `.bmd` with a
 * shadow `.bmd` (`GfxBobLibs` second value). Loading a body layer with its entry attaches the shadow twin
 * drawn under each bob. First-wins on a repeated stem: the recolours of one `.bmd` share its shadow set.
 *
 * Character bodies are absent: they load under a palette no record names (the recolourable `indexed`
 * atlas), and the sheet they feed keeps no shadow lane, so the per-job look carries their twin stem
 * itself.
 */
export function shadowStemsByAtlasStem(ir: ContentIr | null): Map<string, string> {
  const map = new Map<string, string>();
  const put = (stem: string | undefined, shadowBmd: string | undefined): void => {
    const shadowStem = servedShadowStem(shadowBmd);
    if (stem !== undefined && shadowStem !== undefined && !map.has(stem)) map.set(stem, shadowStem);
  };
  for (const row of ir?.landscapeGfx ?? []) put(servedAtlasStem(row), row.shadowBmd);
  for (const row of ir?.buildingBobs ?? []) put(servedAtlasStem(row), row.shadowBmd);
  return map;
}

/** The `[bobseq]` rows of one imagelib in the served IR, indexed by verbatim sequence name. */
export function sequencesFor(ir: ContentIr | null, imagelib: string): Map<string, BobSeqRow> {
  const byName = new Map<string, BobSeqRow>();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  for (const seq of set?.sequences ?? []) byName.set(seq.name, seq);
  return byName;
}

/**
 * Every human `[bobseq]` row by name, across all the `cr_hum_*` body tables. The name space is global:
 * a tribe's `[gfxanimatomic]` records name sequences that live in another body's table - only the viking
 * soldier body ships a table of its own, and the other civilizations' rank-and-file bodies play from it -
 * and no name is defined twice with a different range. A body plays only the subset its own bob pool
 * covers - see {@link playableSequences}.
 */
export function humanSequences(ir: ContentIr | null): Map<string, BobSeqRow> {
  const byName = new Map<string, BobSeqRow>();
  for (const set of ir?.bobSequences ?? []) {
    if (!set.imagelib.startsWith(HUMAN_IMAGELIB_PREFIX)) continue;
    for (const seq of set.sequences ?? []) {
      if (!byName.has(seq.name)) byName.set(seq.name, seq);
    }
  }
  return byName;
}

/** The `cr_hum_*` bob sets: the human body/head libraries, as opposed to the animal and vehicle ones. */
const HUMAN_IMAGELIB_PREFIX = 'cr_hum_';

/**
 * The sequences of `seqByName` that `atlas` can actually draw: every frame of the run must be a bob with
 * pixels. Approximation: reading a filled range as "this body authors this clip" holds for 867 of the 892
 * clip references the tribes' own records make, and dropping the rest is what lets a binding fall back to
 * a gait the body does draw instead of resolving a blank frame, which the renderer draws as the
 * missing-sprite placeholder. The non-viking bodies are the shorter ones, so the filter costs them the
 * pray, talk, listen and kiss atomics, about half the per-good carry gaits, and every `_agressive` combat
 * gait: those settlers walk their plain gait carrying nothing visible and never change stance.
 */
export function playableSequences(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  atlas: SpriteAtlas,
): Map<string, BobSeqRow> {
  const out = new Map<string, BobSeqRow>();
  for (const [name, row] of seqByName) {
    if (row.length > 0 && drawsEveryFrame(atlas, row)) out.set(name, row);
  }
  return out;
}

function drawsEveryFrame(atlas: SpriteAtlas, row: BobSeqRow): boolean {
  for (let bob = row.start; bob < row.start + row.length; bob++) {
    const frame = atlas.frames.get(bob);
    if (frame === undefined || frame.width === 0 || frame.height === 0) return false;
  }
  return true;
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

/** The original selects this one landscape loop for every tribe's holy-fire table entry. The house
 * records own only the repeated anchor points; engine table evidence pins the shared effect name. */
export const HOLY_FIRE_EFFECT_NAME = 'fx fire incense';

export function holyFireLookup(ir: ContentIr | null): HolyFireLookup {
  const byKey = new Map<string, { x: number; y: number }[]>();
  for (const row of ir?.buildingHolyFirePoints ?? []) {
    const key = `${row.tribeId}/${row.typeId}/${row.level}`;
    const points = byKey.get(key);
    if (points === undefined) byKey.set(key, [{ x: row.x, y: row.y }]);
    else points.push({ x: row.x, y: row.y });
  }
  return (tribe, buildingType, level) => {
    const points = byKey.get(`${tribe}/${buildingType}/${level}`);
    return points === undefined ? undefined : { name: HOLY_FIRE_EFFECT_NAME, points };
  };
}

/** One `[gfxanimatomic]` record as a clip candidate: the body bobseq it names and its own frame lists. */
export interface TribeClip {
  readonly seq: string;
  readonly program: GfxAtomicProgram;
}

/**
 * The clips one tribe's own records name for a job, each slot listing the candidates nearest job first:
 * which bobseq that civilization walks, waits and strikes with, and the records every other action
 * plays. The consumer takes the first its body draws.
 */
export interface TribeJobSeqs {
  readonly walk: readonly string[];
  readonly wait: readonly string[];
  readonly attack: readonly string[];
  /** Action → the remaining `[gfxanimatomic]` records (no wait, attack or indoor sub-clip). */
  readonly atomics: ReadonlyMap<number, readonly TribeClip[]>;
}

/**
 * The jobs a `(tribe, job)` clip lookup falls through, in order: each of `jobs`, then its `jobtypes.ini`
 * `baseJob` chain (hero → soldier class → unarmed soldier → civilist). That is the parent walk the
 * original's bob update takes when a job authors no record of its own (byte evidence:
 * `an original routine`, the original an original address). A repeated job stops the walk.
 */
function clipLookupChain(ir: ContentIr | null, jobs: readonly number[]): number[] {
  const baseOf = new Map<number, number>();
  for (const job of ir?.jobs ?? []) {
    if (job.typeId !== undefined && job.baseJob !== undefined) baseOf.set(job.typeId, job.baseJob);
  }
  const chain: number[] = [];
  for (const start of jobs) {
    for (
      let job: number | undefined = start;
      job !== undefined && !chain.includes(job);
      job = baseOf.get(job)
    ) {
      chain.push(job);
    }
  }
  return chain;
}

/**
 * The clip names one tribe's own records give a job, from the records that civilization authors: the
 * unloaded `[gfxwalkatomic]` gait, the `[gfxanimatomic]` base wait (the `gfxanimmode 1` record where
 * there is one), the attack swing and the other actions' records. Every slot lists the answer of each job
 * on the lookup chain of `jobs` in turn, so a job that authors no record of its own inherits its base
 * job's, the way the original resolves a hero to its soldier class. The tribes disagree on which clip a
 * job plays - the egyptian unarmed soldier is authored on the spear clips, the saracen longbowman on the
 * shortbow's - so a look that cannot draw the transcribed viking clip takes the answer its own tribe gives.
 *
 * Approximation: where a job authors several records for one action, the original rolls among them at
 * each play (`an original routine`, the original an original address); here they
 * stay in file order and the consumer plays the first its body draws.
 */
export function tribeJobSeqs(ir: ContentIr | null, tribe: number, jobs: readonly number[]): TribeJobSeqs {
  const walk: string[] = [];
  const wait: string[] = [];
  const attack: string[] = [];
  const atomics = new Map<number, TribeClip[]>();
  const push = (list: string[], seq: string): void => {
    if (!list.includes(seq)) list.push(seq);
  };
  for (const job of clipLookupChain(ir, jobs)) {
    for (const row of ir?.gfxWalkAtomics ?? []) {
      if (row.tribe === tribe && row.job === job && row.goodType === UNLOADED_GOOD_TYPE) {
        push(walk, row.bodySeq);
        break;
      }
    }
    let jobWait: string | undefined;
    let waitIsBase = false;
    let jobAttack: string | undefined;
    for (const row of ir?.gfxAtomics ?? []) {
      if (row.tribe !== tribe || row.job !== job || row.subId !== undefined) continue;
      if (row.action === ATTACK_ATOMIC) {
        jobAttack ??= row.bodySeq;
      } else if (WAIT_ACTIONS.has(row.action)) {
        if (jobWait === undefined || (!waitIsBase && row.mode === GFX_ANIM_MODE_LOOP)) {
          jobWait = row.bodySeq;
          waitIsBase = row.mode === GFX_ANIM_MODE_LOOP;
        }
      } else {
        let clips = atomics.get(row.action);
        if (clips === undefined) {
          clips = [];
          atomics.set(row.action, clips);
        }
        clips.push({
          seq: row.bodySeq,
          program: { dirFrames: row.dirFrames, ...(row.mode !== undefined ? { mode: row.mode } : {}) },
        });
      }
    }
    if (jobWait !== undefined) push(wait, jobWait);
    if (jobAttack !== undefined) push(attack, jobAttack);
  }
  return { walk, wait, attack, atomics };
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
