import type {
  AtlasFrame,
  ByJobTable,
  FrameListAnim,
  SettlerCharacter,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteLayer,
} from '@open-northland/render';
import { MUSHROOM_HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { diag } from '../../diag/index.js';
import {
  carryWalkSeqs,
  type GfxAtomicProgram,
  gfxAtomicProgramsByAction,
  gfxWaitProgramsBySeq,
  gfxWalkFrameLists,
  tribeJobSeqs,
} from '../ir/joins.js';
import type { BobSeqRow, ContentIr } from '../ir/rows.js';
import {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  type CharacterSpecId,
  carryHeadFallback,
  characterBinding,
  frameListsByFacing,
  type GoodRef,
  HERO_JOBS,
  type HeadClip,
  headBinding,
  headClips,
  IDLE_ACTIONS,
  isAnimalBody,
  MUSHROOM_PLUCK_FRAMES,
  MUSHROOM_PLUCKS_PER_PICK,
  UNARMED_WARRIOR_SPEC,
  WARRIOR_JOBS,
  WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG,
  YOUNG_CHARACTER_BY_JOB,
} from '../settler-gfx/index.js';
import type { LoadedLook, ResolvedLook } from './character-looks.js';

/**
 * A body layer with every frame's draw offset dropped by `shift` px (no shift → the layer verbatim) - the
 * anchor calibration a `CharacterSpec.feetShiftY` declares. The cast-shadow twin moves with it: body and
 * silhouette print from one anchor, so a correction to that anchor applies to both.
 */
function feetShiftedLayer(layer: SpriteLayer, shift: number | undefined): SpriteLayer {
  if (shift === undefined || shift === 0) return layer;
  return {
    ...layer,
    atlas: feetShiftedAtlas(layer.atlas, shift),
    ...(layer.shadow !== undefined
      ? { shadow: { ...layer.shadow, atlas: feetShiftedAtlas(layer.shadow.atlas, shift) } }
      : {}),
  };
}

function feetShiftedAtlas(atlas: SpriteAtlas, shift: number): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const [id, frame] of atlas.frames) frames.set(id, { ...frame, offsetY: frame.offsetY + shift });
  return { ...atlas, frames };
}

/** One pick bends {@link MUSHROOM_PLUCKS_PER_PICK} times, so the authored one-shot pluck list repeats
 *  back-to-back into a single continuous motion (`HARVEST_TICKS` sizes the atomic to cover the repeats). */
function repeatMushroomPluck(
  programsByAction: Map<number, Map<string, GfxAtomicProgram>>,
  tribe: number,
): void {
  const pluck = programsByAction.get(MUSHROOM_HARVEST_ATOMIC);
  if (pluck === undefined) return;
  const repeated = new Map(
    [...pluck].map(([seq, program]) => {
      for (const list of program.dirFrames) {
        if (list.length !== MUSHROOM_PLUCK_FRAMES) {
          // The atomic duration is sized off the pin, so a drifted list would cut or pad the motion.
          diag.warn(
            'content',
            `mushroom pluck list '${seq}' (tribe ${tribe}) is ${list.length} frames; HARVEST_TICKS is sized for ${MUSHROOM_PLUCK_FRAMES}`,
          );
        }
      }
      return [
        seq,
        {
          ...program,
          dirFrames: program.dirFrames.map((list) =>
            Array.from({ length: MUSHROOM_PLUCKS_PER_PICK }, () => list).flat(),
          ),
        },
      ] as const;
    }),
  );
  programsByAction.set(MUSHROOM_HARVEST_ATOMIC, repeated);
}

/** The head overlay's binding when it differs from the body's: the source's head clips, then the walk's
 *  head for a carry gait whose head clip is blank. */
function headBindingFor(
  binding: SettlerStateBinding,
  heads: readonly SpriteLayer[],
  clips: ReadonlyMap<number, HeadClip>,
): SettlerStateBinding | undefined {
  // All of a body's heads share one bob layout, so the first head atlas stands for the set.
  const headAtlas = heads[0]?.atlas;
  if (headAtlas === undefined) return undefined;
  const head = carryHeadFallback(headBinding(binding, clips) ?? binding, headAtlas);
  return head === binding ? undefined : head;
}

/** The idle-action clips this body's bob pool draws, other than its base wait: a human body's `wait`
 *  sequences, an animal body's every idle clip. Render schedules them; the rows only define the clips. */
function characterIdleFidgets(
  ir: ContentIr | null,
  tribe: number,
  jobs: readonly number[],
  look: ResolvedLook,
  seqByName: ReadonlyMap<string, BobSeqRow>,
  atlas: SpriteAtlas,
  idle: SettlerStateBinding['idle'],
): readonly FrameListAnim[] {
  const out: FrameListAnim[] = [];
  const seen = new Set<string>();
  const base =
    typeof idle === 'object' && 'frameLists' in idle
      ? `${idle.start}/${JSON.stringify(idle.frameLists)}`
      : '';
  for (const row of ir?.gfxAtomics ?? []) {
    if (
      row.tribe !== tribe ||
      !jobs.includes(row.job) ||
      !IDLE_ACTIONS.includes(row.action) ||
      row.bodySeq === undefined ||
      (!isAnimalBody(look.bodyBmd) && !/wait/i.test(row.bodySeq))
    )
      continue;
    const seq = seqByName.get(row.bodySeq);
    if (seq === undefined || row.dirFrames.every((list) => list.length === 0)) continue;
    if (
      row.dirFrames.some((list) =>
        list.some((offset) => {
          const frame = atlas.frames.get(seq.start + offset);
          return frame === undefined || frame.width === 0 || frame.height === 0;
        }),
      )
    )
      continue;
    const frameLists = frameListsByFacing(row.dirFrames);
    const key = `${seq.start}/${JSON.stringify(frameLists)}`;
    if (key === base || seen.has(key)) continue;
    seen.add(key);
    out.push({ start: seq.start, frameLists });
  }
  return out;
}

/** What one tribe's table is composed from: its looks, the loaded bob sets, each body's playable
 *  `[bobseq]` rows, and every human row, where a head clip is looked up whether or not the body draws it. */
export interface TribeCharacterInputs {
  readonly looks: ReadonlyMap<CharacterSpecId, readonly ResolvedLook[]>;
  readonly animalJobs?: ReadonlyMap<number, readonly ResolvedLook[]>;
  readonly layersByBody: ReadonlyMap<string, LoadedLook>;
  readonly sequencesByBody: ReadonlyMap<string, ReadonlyMap<string, BobSeqRow>>;
  readonly sequences: ReadonlyMap<string, BobSeqRow>;
}

/**
 * One civilization's per-job character table, or `undefined` when neither it nor `base` yields a default
 * look. The same character specs compose from this tribe's own `[jobbasegraphics]` bobs and its own
 * animation programs: the same body bobseq name recurs across the tribes with different per-direction
 * frame lists, so a soldier drawing another tribe's programs would swing the wrong motion.
 *
 * A tribe authors only part of the roster - the werewolf authors a soldier and nothing else, the
 * weresnake a soldier and its animal forms - so every slot it leaves empty is filled from `base`. That
 * keeps the job right where the tribe is wrong, which reads better than putting the tribe's own civilian
 * man under a woman's or a child's job.
 */
export function tribeCharacters(
  ir: ContentIr | null,
  goods: readonly GoodRef[],
  tribe: number,
  inputs: TribeCharacterInputs,
  base?: ByJobTable<SettlerCharacter>,
): ByJobTable<SettlerCharacter> | undefined {
  const programsByAction = gfxAtomicProgramsByAction(ir, tribe);
  repeatMushroomPluck(programsByAction, tribe);
  const waitBySeq = gfxWaitProgramsBySeq(ir, tribe);
  const walkLists = gfxWalkFrameLists(ir, tribe);
  // This civilization's indoor craft clips; each body keeps the ones its own atlas holds sequences for.
  const subClips = (ir?.gfxAtomics ?? []).filter((row) => row.tribe === tribe && row.subId !== undefined);

  const resolveCharacter = (
    spec: (typeof CHARACTER_SPEC_ENTRIES)[number][1],
    looks: readonly ResolvedLook[],
  ): SettlerCharacter | undefined => {
    // The first look in the spec's chain that both decoded and binds: a record can name a body the
    // pipeline emits no atlas for, or one whose clips this tribe's programs do not drive, and that class
    // must degrade to the tribe's plain soldier rather than to its civilian.
    for (const look of looks) {
      const layers = inputs.layersByBody.get(look.bodyStem);
      const seqByName = inputs.sequencesByBody.get(look.bodyStem);
      if (layers === undefined || seqByName === undefined) continue;
      const tribeSeqs = tribeJobSeqs(ir, tribe, spec.gfxJobs);
      const bound = characterBinding(spec, seqByName, goods, {
        ...(spec.logicJob !== undefined ? { carrySeqBySlug: carryWalkSeqs(ir, tribe, spec.logicJob) } : {}),
        // Own-clip names keyed by the settler's job, as the original looks them up, never by the record
        // that drew the body: the spec's own job first, so a class whose body the tribe does not author
        // still gets the motion it authors for that class (the saracen bowman's shortbow swing on the
        // plain soldier body), then the classes it degrades through.
        tribeSeqs,
        programsByAction,
        waitBySeq,
        walkLists,
        subClips,
        bodyAtlas: layers.body.atlas,
      });
      if (bound === null) continue;
      const idleFidgets = characterIdleFidgets(
        ir,
        tribe,
        spec.gfxJobs,
        look,
        seqByName,
        layers.body.atlas,
        bound.idle,
      );
      const binding = idleFidgets.length > 0 ? { ...bound, idleFidgets } : bound;
      const heads = look.headStems
        .map((stem) => layers.headsByStem.get(stem))
        .filter((l): l is SpriteLayer => l !== undefined);
      const head = headBindingFor(binding, heads, headClips(seqByName, tribeSeqs.heads, inputs.sequences));
      return {
        body: feetShiftedLayer(layers.body, spec.feetShiftY),
        ...(look.indexed ? {} : { indexed: false }),
        ...(heads.length > 0 ? { heads } : {}),
        binding,
        ...(head !== undefined ? { headBinding: head } : {}),
      };
    }
    return undefined;
  };
  const bySpec = new Map<CharacterSpecId, SettlerCharacter>();
  for (const [specId, spec] of CHARACTER_SPEC_ENTRIES) {
    const character = resolveCharacter(spec, inputs.looks.get(specId) ?? []);
    if (character !== undefined) bySpec.set(specId, character);
  }

  const fallback = bySpec.get('civilian') ?? base?.default;
  if (fallback === undefined) return undefined;
  const byJob: Record<number, SettlerCharacter> = { ...base?.byJob };
  for (const [job, specId] of Object.entries(ADULT_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) byJob[Number(job)] = char;
  }
  const animalBodyJobs: number[] = [];
  for (const [job, looks] of inputs.animalJobs ?? []) {
    const char = resolveCharacter({ gfxJobs: [job] }, looks);
    if (char !== undefined) {
      byJob[job] = char;
      animalBodyJobs.push(job);
    }
  }
  const youngByJob: Record<number, SettlerCharacter> = { ...base?.youngByJob };
  for (const [job, specId] of Object.entries(YOUNG_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) youngByJob[Number(job)] = char;
  }
  const fixedByJob: Record<number, SettlerCharacter> = { ...base?.fixedByJob };
  for (const job of HERO_JOBS) {
    const char = byJob[job];
    if (char !== undefined) fixedByJob[job] = char;
  }
  // These mission jobs name their whole animal body by job. A worn weapon may drive combat, but it
  // must not replace the wolf/lion/bear body with the weapon class's generic warrior look.
  for (const job of animalBodyJobs) {
    const char = byJob[job];
    if (char !== undefined) fixedByJob[job] = char;
  }
  // The equipped-weapon look table, joined slug → the running content's good typeId, so the key matches
  // whatever `Equipment.weapon.goodType` the sim actually stamps.
  const byWeaponGood: Record<number, SettlerCharacter> = { ...base?.byWeaponGood };
  for (const good of goods) {
    const specId = WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG[good.id];
    if (specId === undefined) continue;
    const char = bySpec.get(specId);
    if (char !== undefined) byWeaponGood[good.typeId] = char;
  }
  // The disarmed look, keyed by the re-armable jobs only, so an axe soldier - no axe good exists to
  // re-arm with - never loses its drawn axe this way.
  const unarmedByJob: Record<number, SettlerCharacter> = { ...base?.unarmedByJob };
  const bareWarrior = bySpec.get(UNARMED_WARRIOR_SPEC);
  if (bareWarrior !== undefined) for (const job of WARRIOR_JOBS) unarmedByJob[job] = bareWarrior;
  return { byJob, youngByJob, fixedByJob, byWeaponGood, unarmedByJob, default: fallback };
}
