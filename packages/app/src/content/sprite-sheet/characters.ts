import type {
  AtlasFrame,
  SettlerCharacter,
  SettlerCharacterSet,
  SettlerStateBinding,
  SpriteLayer,
} from '@open-northland/render';
import { MUSHROOM_HARVEST_ATOMIC } from '../../catalog/atomics.js';
import { characterStem, characterStems, VIKING_CHARACTERS } from '../../catalog/roster.js';
import { diag } from '../../diag/index.js';
import {
  carryWalkSeqs,
  gfxAtomicProgramsByAction,
  gfxWaitProgramsBySeq,
  gfxWalkFrameLists,
  sequencesFor,
} from '../ir/joins.js';
import { loadGalleryLayers, MissingAtlasError } from '../ir/load.js';
import type { ContentIr } from '../ir/rows.js';
import {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
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

/**
 * The viking `[gfxanimatomic]` `logictribe` - `logicdefines.inc` `TRIBE_TYPE_HUMAN_VIKING = 1`. Not the
 * tribetypes `logicType` (also 1 for viking, but 4 there is Saracen). The same body bobseq name recurs
 * across the human tribes with different per-direction frame lists, so the attack swings must be drawn
 * from this tribe's records, else a soldier swings a different tribe's motion.
 */
const VIKING_ANIM_TRIBE = 1;

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

/**
 * Load the per-job {@link SettlerCharacterSet}: every `CHARACTER_SPECS` look whose body atlas and sequences
 * resolve, joined to jobs by the adult/young tables. A head that 404s is skipped, and a body that 404s or
 * an unresolvable binding drops that look to the default. Returns `undefined`, degrading the sheet to the
 * single-body path, when the IR carries no sequences or the civilian look can't be built.
 */
export async function loadCharacters(
  ir: ContentIr | null,
  goods: readonly GoodRef[],
  palette: string,
): Promise<SettlerCharacterSet | undefined> {
  if (ir?.bobSequences === undefined || ir.bobSequences.length === 0) return undefined;

  const rosterById = new Map(VIKING_CHARACTERS.map((c) => [c.id, c]));
  // One load per roster body, not per look: the six soldier looks share one armoured body atlas.
  const rosterIds = [...new Set(CHARACTER_SPEC_ENTRIES.map(([, s]) => s.rosterId))];
  const layersByRoster = new Map<string, { body: SpriteLayer; headsByStem: Map<string, SpriteLayer> }>();
  await Promise.all(
    rosterIds.map(async (rosterId) => {
      const character = rosterById.get(rosterId);
      if (character === undefined) return;
      const stems = characterStems(character, palette);
      try {
        const { body, heads } = await loadGalleryLayers(stems.bodyStem, stems.headStems);
        const headsByStem = new Map<string, SpriteLayer>();
        heads.forEach((layer, i) => {
          const stem = stems.headStems[i];
          if (layer !== undefined && stem !== undefined) headsByStem.set(stem, layer);
        });
        layersByRoster.set(rosterId, { body, headsByStem });
      } catch (err) {
        // An optional look must never kill the boot. A missing body is the expected undecoded-content
        // case; any other failure is a real bug, so warn but still degrade this look to the default.
        if (!(err instanceof MissingAtlasError)) {
          diag.warn(
            'content',
            `character look '${rosterId}' failed to load - falling back to the default look`,
            err,
          );
        }
      }
    }),
  );

  // Every viking `[gfxanimatomic]` program, action → swing bobseq name → frame lists + mode. Built
  // once; a spec whose seq has no program falls that atomic back to its plain strip.
  const programsByAction = gfxAtomicProgramsByAction(ir, VIKING_ANIM_TRIBE);
  // One pick bends MUSHROOM_PLUCKS_PER_PICK times: repeat the authored one-shot pluck list back-to-back so
  // the whole pick is a single continuous motion (HARVEST_TICKS sizes the atomic to cover the repeats).
  const pluck = programsByAction.get(MUSHROOM_HARVEST_ATOMIC);
  if (pluck !== undefined) {
    programsByAction.set(
      MUSHROOM_HARVEST_ATOMIC,
      new Map(
        [...pluck].map(([seq, program]) => {
          for (const list of program.dirFrames) {
            if (list.length !== MUSHROOM_PLUCK_FRAMES) {
              // The atomic duration is sized off the pin, so a drifted list would cut or pad the motion.
              diag.warn(
                'content',
                `mushroom pluck list '${seq}' is ${list.length} frames; HARVEST_TICKS is sized for ${MUSHROOM_PLUCK_FRAMES}`,
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
      ),
    );
  }
  const waitBySeq = gfxWaitProgramsBySeq(ir, VIKING_ANIM_TRIBE);
  const walkLists = gfxWalkFrameLists(ir, VIKING_ANIM_TRIBE);
  // The indoor craft clips of the whole tribe; each body keeps the ones its own atlas holds sequences for.
  const subClips = (ir.gfxAtomics ?? []).filter(
    (row) => row.tribe === VIKING_ANIM_TRIBE && row.subId !== undefined,
  );

  const bySpec = new Map<string, SettlerCharacter>();
  for (const [specId, spec] of CHARACTER_SPEC_ENTRIES) {
    const layers = layersByRoster.get(spec.rosterId);
    const roster = rosterById.get(spec.rosterId);
    if (layers === undefined || roster === undefined) continue;
    const binding = characterBinding(spec, sequencesFor(ir, roster.imagelib), goods, {
      ...(spec.logicJob !== undefined
        ? { carrySeqBySlug: carryWalkSeqs(ir, VIKING_ANIM_TRIBE, spec.logicJob) }
        : {}),
      programsByAction,
      waitBySeq,
      walkLists,
      subClips,
    });
    if (binding === null) continue;
    const heads = (spec.headBmds ?? roster.headBmds)
      .map((bmd) => layers.headsByStem.get(characterStem(bmd, palette)))
      .filter((l): l is SpriteLayer => l !== undefined);
    // All of a body's heads share one bob layout, so checking the first head atlas stands for the set.
    const byGood = binding.carrying?.byGood;
    const headAtlas = heads[0]?.atlas;
    // The head-borrow reference is the plain walk; `moving` is never a FrameListAnim (walk lists reduce
    // to a directional block cut), so exclude that kind to keep the type.
    const moving = binding.moving;
    const walk = typeof moving === 'object' && !('frameLists' in moving) ? moving : undefined;
    let headBinding: SettlerStateBinding | undefined;
    if (byGood !== undefined && headAtlas !== undefined) {
      const headByGood = carryHeadAnims(byGood, walk, headAtlas);
      if (headByGood !== byGood) {
        headBinding = { ...binding, carrying: { ...binding.carrying, byGood: headByGood } };
      }
    }
    bySpec.set(specId, {
      body: feetShiftedLayer(layers.body, spec.feetShiftY),
      ...(heads.length > 0 ? { heads } : {}),
      binding,
      ...(headBinding !== undefined ? { headBinding } : {}),
    });
  }

  const fallback = bySpec.get('civilian');
  if (fallback === undefined) return undefined;
  const byJob: Record<number, SettlerCharacter> = {};
  for (const [job, specId] of Object.entries(ADULT_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) byJob[Number(job)] = char;
  }
  const youngByJob: Record<number, SettlerCharacter> = {};
  for (const [job, specId] of Object.entries(YOUNG_CHARACTER_BY_JOB)) {
    const char = bySpec.get(specId);
    if (char !== undefined) youngByJob[Number(job)] = char;
  }
  // The equipped-weapon look table, joined slug → the running content's good typeId, so the key matches
  // whatever `Equipment.weapon.goodType` the sim actually stamps.
  const byWeaponGood: Record<number, SettlerCharacter> = {};
  for (const good of goods) {
    const specId = WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG[good.id];
    if (specId === undefined) continue;
    const char = bySpec.get(specId);
    if (char !== undefined) byWeaponGood[good.typeId] = char;
  }
  // The disarmed look, keyed by the re-armable jobs only, so an axe soldier - no axe good exists to
  // re-arm with - never loses its drawn axe this way.
  const unarmedByJob: Record<number, SettlerCharacter> = {};
  const bareWarrior = bySpec.get(UNARMED_WARRIOR_SPEC);
  if (bareWarrior !== undefined) for (const job of WARRIOR_JOBS) unarmedByJob[job] = bareWarrior;
  return { byJob, youngByJob, byWeaponGood, unarmedByJob, default: fallback };
}
