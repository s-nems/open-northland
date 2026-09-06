import type {
  AtlasFrame,
  ByJobTable,
  SettlerCharacter,
  SettlerStateBinding,
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
  carryHeadAnims,
  characterBinding,
  type GoodRef,
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
 * anchor calibration a `CharacterSpec.feetShiftY` declares.
 */
function feetShiftedLayer(layer: SpriteLayer, shift: number | undefined): SpriteLayer {
  if (shift === undefined || shift === 0) return layer;
  const frames = new Map<number, AtlasFrame>();
  for (const [id, frame] of layer.atlas.frames) frames.set(id, { ...frame, offsetY: frame.offsetY + shift });
  return { ...layer, atlas: { ...layer.atlas, frames } };
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

/** The head overlay's own binding when a carry variant's head bobs are empty, so it plays the base walk's
 *  head instead of walking headless. Absent when every carry look authors its head. */
function headBindingFor(
  binding: SettlerStateBinding,
  heads: readonly SpriteLayer[],
): { headBinding?: SettlerStateBinding } {
  const byGood = binding.carrying?.byGood;
  // All of a body's heads share one bob layout, so checking the first head atlas stands for the set.
  const headAtlas = heads[0]?.atlas;
  if (byGood === undefined || headAtlas === undefined) return {};
  // The head-borrow reference is the plain walk; `moving` is never a FrameListAnim (walk lists reduce to a
  // directional block cut), so exclude that kind to keep the type.
  const moving = binding.moving;
  const walk = typeof moving === 'object' && !('frameLists' in moving) ? moving : undefined;
  const headByGood = carryHeadAnims(byGood, walk, headAtlas);
  if (headByGood === byGood) return {};
  return { headBinding: { ...binding, carrying: { ...binding.carrying, byGood: headByGood } } };
}

/** What one tribe's table is composed from: its looks, the loaded bob sets, and each body's playable
 *  `[bobseq]` rows. */
export interface TribeCharacterInputs {
  readonly looks: ReadonlyMap<CharacterSpecId, readonly ResolvedLook[]>;
  readonly layersByBody: ReadonlyMap<string, LoadedLook>;
  readonly sequencesByBody: ReadonlyMap<string, ReadonlyMap<string, BobSeqRow>>;
}

/**
 * One civilization's per-job character table, or `undefined` when neither it nor `base` yields a default
 * look. The same character specs compose from this tribe's own `[jobbasegraphics]` bobs and its own
 * animation programs: the same body bobseq name recurs across the tribes with different per-direction
 * frame lists, so a soldier drawing another tribe's programs would swing the wrong motion.
 *
 * A tribe authors only part of the roster - the weresnake and the werewolf author a soldier and nothing
 * else - so every slot it leaves empty is filled from `base`. That keeps the job right where the tribe is
 * wrong, which reads better than putting the tribe's own civilian man under a woman's or a child's job.
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

  const bySpec = new Map<CharacterSpecId, SettlerCharacter>();
  for (const [specId, spec] of CHARACTER_SPEC_ENTRIES) {
    // The first look in the spec's chain that both decoded and binds: a record can name a body the
    // pipeline emits no atlas for, or one whose clips this tribe's programs do not drive, and that class
    // must degrade to the tribe's plain soldier rather than to its civilian.
    for (const look of inputs.looks.get(specId) ?? []) {
      const layers = inputs.layersByBody.get(look.bodyStem);
      const seqByName = inputs.sequencesByBody.get(look.bodyStem);
      if (layers === undefined || seqByName === undefined) continue;
      const binding = characterBinding(spec, seqByName, goods, {
        ...(spec.logicJob !== undefined ? { carrySeqBySlug: carryWalkSeqs(ir, tribe, spec.logicJob) } : {}),
        // Two sources of own-clip names, the spec's own job first: a class whose body the tribe does not
        // author still gets the motion it authors for that class (the saracen bowman's shortbow swing on
        // the plain soldier body), and the degraded record's job fills what that job leaves unnamed.
        tribeSeqs: {
          ...tribeJobSeqs(ir, tribe, look.job),
          ...(spec.logicJob !== undefined ? tribeJobSeqs(ir, tribe, spec.logicJob) : {}),
        },
        programsByAction,
        waitBySeq,
        walkLists,
        subClips,
        bodyAtlas: layers.body.atlas,
      });
      if (binding === null) continue;
      const heads = look.headStems
        .map((stem) => layers.headsByStem.get(stem))
        .filter((l): l is SpriteLayer => l !== undefined);
      bySpec.set(specId, {
        body: feetShiftedLayer(layers.body, spec.feetShiftY),
        ...(heads.length > 0 ? { heads } : {}),
        binding,
        ...headBindingFor(binding, heads),
      });
      break;
    }
  }

  const fallback = bySpec.get('civilian') ?? base?.default;
  if (fallback === undefined) return undefined;
  const byJob: Record<number, SettlerCharacter> = { ...base?.byJob };
  for (const [job, specId] of Object.entries(ADULT_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) byJob[Number(job)] = char;
  }
  const youngByJob: Record<number, SettlerCharacter> = { ...base?.youngByJob };
  for (const [job, specId] of Object.entries(YOUNG_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) youngByJob[Number(job)] = char;
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
  return { byJob, youngByJob, byWeaponGood, unarmedByJob, default: fallback };
}
