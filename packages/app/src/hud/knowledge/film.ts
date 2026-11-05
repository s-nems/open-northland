import {
  createHumanPaletteIdentity,
  DEFAULT_FACING,
  type FrameListAnim,
  frameOf,
  type HumanPaletteBook,
  type HumanPaletteIdentity,
  type SpriteFrameRef,
  UNARMORED_TIER,
} from '@open-northland/render';
import { MS_PER_TICK } from '@open-northland/sim';
import {
  ANIMAL_BODY_IMAGELIB,
  ANIMAL_PALETTE_BY_TRIBE,
  animalBodyStem,
} from '../../catalog/animal-roster.js';
import {
  ATTACK_ATOMIC,
  CHEER_ATOMIC,
  EAT_ATOMIC,
  EAT_CANDY_ATOMIC,
  EXERCISE_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  KISS_ATOMIC,
  KISSED_ATOMIC,
  LISTEN_ATOMIC,
  OPEN_CHEST_ATOMIC,
  PRAY_ATOMIC,
  SLEEP_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  TALK_ATOMIC,
} from '../../catalog/atomics.js';
import { JOB_BABY_FEMALE, JOB_CHILD_FEMALE, JOB_HEROINE_BOW, JOB_WOMAN } from '../../catalog/jobs.js';
import { PLAYER_COLOR_NAMES } from '../../catalog/roster.js';
import { animalBinding } from '../../content/animal-gfx/bindings.js';
import { VIKING_TRIBE } from '../../content/building-gfx/index.js';
import {
  clipLookupChain,
  gfxAtomicProgramsByAction,
  humanSequences,
  sequencesFor,
} from '../../content/ir/joins.js';
import type { BobSeqRow, ContentIr, GfxAnimAtomicRow, GfxWalkAtomicRow } from '../../content/ir/rows.js';
import {
  DEFAULT_PALETTE,
  eightDirAnim,
  frameListsByFacing,
  headBinding,
  headClips,
  IDLE_ACTIONS,
  isAnimalBody,
  lookFrom,
  lookStem,
  programFrameLists,
  type TribeLook,
} from '../../content/settler-gfx/index.js';
import type { KnowledgeClip } from './model.js';

/** One sheet's share of a film: the served stems that can draw it, best first, and its bob per step. */
export interface FilmLayer {
  readonly stems: readonly string[];
  readonly bobs: readonly number[];
  /** Which composed palette colours the layer; absent keeps the stem's own. */
  readonly palette?: 'body' | 'head';
}

/** A looping preview ready to load: body, then the head drawn over it at the same step. */
export interface KnowledgeFilm {
  readonly layers: readonly FilmLayer[];
  readonly stepMs: number;
  /** What a human's palettes compose from; absent for a body drawn in its baked skin. */
  readonly identity?: HumanPaletteIdentity;
}

type JobClip = Extract<KnowledgeClip, { readonly kind: 'job' }>;
type AnimalClip = Extract<KnowledgeClip, { readonly kind: 'animal' }>;

/** The side a film shows: the south-east view, the one the map draws a standing figure at. */
const FILM_FACING = DEFAULT_FACING;
/** One frame loops as a still, which is no film. */
const MIN_FILM_STEPS = 2;
/** The film's team colour: grey, so no reader takes it for a player of the running game. */
const FILM_PLAYER = PLAYER_COLOR_NAMES.indexOf('grey');
/** Picks the same rolled clothes each time a film opens. */
const FILM_SEED = 1;
/** The unloaded row of `[gfxwalkatomic]`. */
const UNLOADED = 0;

const FEMALE_JOBS: ReadonlySet<number> = new Set([
  JOB_BABY_FEMALE,
  JOB_CHILD_FEMALE,
  JOB_WOMAN,
  JOB_HEROINE_BOW,
]);

/** Records of daily life any worker plays: what is left of a job's records is its trade. */
const NOT_TRADE_ACTIONS: ReadonlySet<number> = new Set([
  ...IDLE_ACTIONS,
  ATTACK_ATOMIC,
  CHEER_ATOMIC,
  EAT_ATOMIC,
  EAT_CANDY_ATOMIC,
  EXERCISE_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  KISS_ATOMIC,
  KISSED_ATOMIC,
  LISTEN_ATOMIC,
  OPEN_CHEST_ATOMIC,
  PRAY_ATOMIC,
  SLEEP_ATOMIC,
  STORE_PICKUP_ATOMIC,
  STORE_PILEUP_ATOMIC,
  TALK_ATOMIC,
]);

/** The bobs one play of `ref` draws at `facing`, in order, whatever the shape of the binding. */
export function filmBobs(ref: SpriteFrameRef, facing: number): readonly number[] {
  if (typeof ref === 'number') return [ref];
  if ('frameLists' in ref) {
    const list = ref.frameLists.length === 1 ? ref.frameLists[0] : ref.frameLists[facing];
    return (list ?? []).map((offset) => ref.start + offset);
  }
  const steps = ref.frames ?? ref.stride;
  const ticksPerFrame = ref.ticksPerFrame ?? 1;
  return Array.from({ length: steps }, (_, step) => frameOf(ref, facing, step * ticksPerFrame));
}

/** A clip's time per drawn step: one play spans `ticks` where the record binds a length, else a step lasts
 *  a tick, as the map plays it. */
export function filmStepMs(steps: number, ticks: number | undefined): number {
  return ticks === undefined ? MS_PER_TICK : (MS_PER_TICK * ticks) / steps;
}

/** The look a job draws in a tribe, up its base-job chain, and the jobs that share its body: a record
 *  further up names clips of another bob layout at the same ids. */
function jobLook(
  ir: ContentIr,
  tribe: number,
  job: number,
): { readonly look: TribeLook; readonly jobs: readonly number[] } | null {
  const chain = clipLookupChain(ir, [job]);
  const graphics = (of: number) => ir.jobGraphics?.find((row) => row.tribe === tribe && row.job === of);
  const row = chain.map(graphics).find((found) => found !== undefined);
  if (row === undefined) return null;
  const end = chain.findIndex((link) => {
    const body = graphics(link)?.body;
    return body !== undefined && body !== row.body;
  });
  return { look: lookFrom(row), jobs: end === -1 ? chain : chain.slice(0, end) };
}

interface ActionRecord {
  readonly bodySeq: string;
  readonly headSeq?: string | undefined;
  readonly ref: FrameListAnim;
  readonly ticks?: number | undefined;
}

/** The body's own `[bobseq]` table, or every human table for a body shipping none. */
function bodyTable(ir: ContentIr, bodyBmd: string): ReadonlyMap<string, BobSeqRow> {
  const own = sequencesFor(ir, `${bodyBmd}.bmd`);
  return own.size > 0 ? own : humanSequences(ir);
}

function actionRecord(
  ir: ContentIr,
  table: ReadonlyMap<string, BobSeqRow>,
  tribe: number,
  jobs: readonly number[],
  wanted: (row: GfxAnimAtomicRow) => boolean,
): ActionRecord | null {
  const programs = gfxAtomicProgramsByAction(ir, tribe);
  for (const job of jobs) {
    for (const row of ir.gfxAtomics ?? []) {
      if (row.tribe !== tribe || row.job !== job || !wanted(row)) continue;
      const seq = row.bodySeq === undefined ? undefined : table.get(row.bodySeq);
      if (seq === undefined || row.bodySeq === undefined) continue;
      const ref = { start: seq.start, frameLists: programFrameLists(row.dirFrames, seq.length) };
      if (filmBobs(ref, FILM_FACING).length < MIN_FILM_STEPS) continue;
      // An indoor clip plays a tick a step inside a program; its action's length spans the whole craft.
      const ticks = row.subId === undefined ? programs.get(row.action)?.get(row.bodySeq)?.ticks : undefined;
      return { bodySeq: row.bodySeq, headSeq: row.headSeq, ref, ticks };
    }
  }
  return null;
}

function walkRecord(
  ir: ContentIr,
  table: ReadonlyMap<string, BobSeqRow>,
  tribe: number,
  jobs: readonly number[],
): ActionRecord | null {
  for (const job of jobs) {
    const row: GfxWalkAtomicRow | undefined = ir.gfxWalkAtomics?.find(
      (walk) => walk.tribe === tribe && walk.job === job && walk.goodType === UNLOADED,
    );
    const seq = row === undefined ? undefined : table.get(row.bodySeq);
    if (row === undefined || seq === undefined) continue;
    const lists =
      row.dirFrames === undefined ? stripLists(table, row.bodySeq) : frameListsByFacing(row.dirFrames);
    return { bodySeq: row.bodySeq, headSeq: row.headSeq, ref: { start: seq.start, frameLists: lists } };
  }
  return null;
}

/** A walk row with no lists plays its strip block by block. */
function stripLists(table: ReadonlyMap<string, BobSeqRow>, name: string): readonly (readonly number[])[] {
  const anim = eightDirAnim(table, name);
  if (anim === undefined) return [];
  return Array.from({ length: anim.dirs }, (_, dir) =>
    Array.from({ length: anim.stride }, (_, step) => dir * anim.stride + step),
  );
}

/** The record of a tribe's job doing `action`; a civilization that authors none plays the base tribe's
 *  where its body draws that clip. */
function jobRecord(
  ir: ContentIr,
  table: ReadonlyMap<string, BobSeqRow>,
  tribe: number,
  jobs: readonly number[],
  action: 'attack' | 'walk' | 'work',
): ActionRecord | null {
  const lookup = (from: number): ActionRecord | null => {
    if (action === 'walk') return walkRecord(ir, table, from, jobs);
    if (action === 'attack') {
      return actionRecord(ir, table, from, jobs, (row) => row.action === ATTACK_ATOMIC);
    }
    return actionRecord(ir, table, from, tradeJobs(jobs), (row) => !NOT_TRADE_ACTIONS.has(row.action));
  };
  return lookup(tribe) ?? (tribe === VIKING_TRIBE ? null : lookup(VIKING_TRIBE));
}

/** The chain without its root: a civilist's or a woman's records are everyone's life, no one's trade. */
function tradeJobs(jobs: readonly number[]): readonly number[] {
  return jobs.slice(0, -1);
}

/** The composition the map gives a human of this job, in the film's neutral team colour and unarmored. */
function jobIdentity(
  ir: ContentIr,
  book: HumanPaletteBook,
  look: TribeLook,
  clip: JobClip,
): HumanPaletteIdentity {
  const job = clip.jobType;
  const identity = createHumanPaletteIdentity(look.palette);
  identity.player = FILM_PLAYER;
  identity.female = FEMALE_JOBS.has(job);
  identity.seed = FILM_SEED;
  identity.jobChange = book.jobChangeRecipe(clip.tribe, job);
  const soldier = ir.jobs?.find((row) => row.typeId === job)?.id?.startsWith('soldier') === true;
  if (soldier) identity.armorTier = UNARMORED_TIER;
  identity.weaponRamp = look.palette.weapon?.rampByJob[job];
  return identity;
}

function jobFilm(ir: ContentIr, book: HumanPaletteBook | undefined, clip: JobClip): KnowledgeFilm | null {
  const found = jobLook(ir, clip.tribe, clip.jobType);
  if (found === null) return null;
  const { look, jobs } = found;
  const animal = isAnimalBody(look.bodyBmd);
  const table = animal ? sequencesFor(ir, ANIMAL_BODY_IMAGELIB) : bodyTable(ir, look.bodyBmd);
  const record = jobRecord(ir, table, clip.tribe, jobs, clip.action);
  if (record === null) return null;
  const bobs = filmBobs(record.ref, FILM_FACING);
  if (bobs.length < MIN_FILM_STEPS) return null;
  const stepMs = filmStepMs(bobs.length, record.ticks);
  const bodyStems = [lookStem(look.bodyBmd, look.bodyPalette), lookStem(look.bodyBmd, DEFAULT_PALETTE)];
  if (animal) return { layers: [{ stems: bodyStems, bobs }], stepMs };
  const composed = book !== undefined;
  const body: FilmLayer = { stems: bodyStems, bobs, ...(composed ? { palette: 'body' } : {}) };
  const headBmd = look.headBmds[0];
  const head: readonly FilmLayer[] =
    headBmd === undefined
      ? []
      : [
          {
            stems: [lookStem(headBmd, look.headPalette), lookStem(headBmd, DEFAULT_PALETTE)],
            bobs: filmBobs(headRef(ir, table, record), FILM_FACING),
            ...(composed ? { palette: 'head' } : {}),
          },
        ];
  return {
    layers: [body, ...head],
    stepMs,
    ...(book !== undefined ? { identity: jobIdentity(ir, book, look, clip) } : {}),
  };
}

/** Where a record names a head clip the head reads it, else the body's own bob ids. */
function headRef(
  ir: ContentIr,
  table: ReadonlyMap<string, BobSeqRow>,
  { bodySeq, headSeq, ref }: ActionRecord,
): SpriteFrameRef {
  const row = table.get(bodySeq);
  if (headSeq === undefined || row === undefined) return ref;
  const clips = headClips(new Map([[bodySeq, row]]), new Map([[bodySeq, headSeq]]), humanSequences(ir));
  return headBinding({ idle: ref }, clips)?.idle ?? ref;
}

function animalFilm(ir: ContentIr, clip: AnimalClip): KnowledgeFilm | null {
  const palette = ANIMAL_PALETTE_BY_TRIBE.get(clip.animalTribe);
  if (palette === undefined) return null;
  const binding = animalBinding(ir, clip.animalTribe, sequencesFor(ir, ANIMAL_BODY_IMAGELIB));
  const ref = clip.action === 'walk' ? binding?.moving : binding?.byAtomic?.[ATTACK_ATOMIC];
  if (ref === undefined) return null;
  const bobs = filmBobs(ref, FILM_FACING);
  if (bobs.length < MIN_FILM_STEPS) return null;
  const [program] =
    clip.action === 'walk'
      ? []
      : (gfxAtomicProgramsByAction(ir, clip.animalTribe).get(ATTACK_ATOMIC)?.values() ?? []);
  return {
    layers: [{ stems: [animalBodyStem(palette)], bobs }],
    stepMs: filmStepMs(bobs.length, program?.ticks),
  };
}

/** The film of `clip`; null when the content draws it no frames, which reserves no room. Frame lists come
 *  from the records the map plays (`gfxAtomics`, `gfxWalkAtomics`), never the raw `[bobseq]` strip: a
 *  strip packs the facings and takes back to back. */
export function knowledgeFilm(
  ir: ContentIr,
  book: HumanPaletteBook | undefined,
  clip: KnowledgeClip,
): KnowledgeFilm | null {
  return clip.kind === 'job' ? jobFilm(ir, book, clip) : animalFilm(ir, clip);
}
