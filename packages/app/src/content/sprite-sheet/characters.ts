import type {
  AtlasFrame,
  SettlerCharacter,
  SettlerCharacterSet,
  SettlerStateBinding,
  SpriteLayer,
} from '@open-northland/render';
import {
  ATTACK_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  KISS_ATOMIC,
  KISSED_ATOMIC,
  LISTEN_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  PLANT_ATOMIC,
  STONE_HARVEST_ATOMIC,
  TALK_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import { characterStem, characterStems, VIKING_CHARACTERS } from '../../catalog/roster.js';
import { diag } from '../../diag/index.js';
import {
  type ContentIr,
  gfxAtomicFrameLists,
  loadGalleryLayers,
  MissingAtlasError,
  sequencesFor,
} from '../ir.js';
import {
  ADULT_CHARACTER_BY_JOB,
  CHARACTER_SPEC_ENTRIES,
  carryHeadAnims,
  characterBinding,
  type GoodRef,
  MUSHROOM_PLUCK_FRAMES,
  MUSHROOM_PLUCKS_PER_PICK,
  WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG,
  YOUNG_CHARACTER_BY_JOB,
} from '../settler-gfx/index.js';

/**
 * The viking `[gfxanimatomic]` `logictribe` — `logicdefines.inc` `TRIBE_TYPE_HUMAN_VIKING = 1`. Not the
 * tribetypes `logicType` (also 1 for viking, but 4 there is Saracen), and not a value to guess: the same
 * body bobseq name recurs across the human tribes with different per-direction frame lists, so the attack
 * swings must be drawn from this tribe's records (`gfxAtomicFrameLists`), else a soldier swings a
 * different tribe's motion. See the scoped-id gotcha in the root AGENTS.md.
 */
const VIKING_ANIM_TRIBE = 1;

/**
 * A body layer with every frame's draw offset dropped by `shift` px (no shift → the layer verbatim) —
 * the committed anchor calibration a {@link import('../settler-gfx/index.js').CharacterSpec.feetShiftY}
 * declares (the baby lib's authored hotspots sit above its sprite, so it drew hovering).
 */
function feetShiftedLayer(layer: SpriteLayer, shift: number | undefined): SpriteLayer {
  if (shift === undefined || shift === 0) return layer;
  const frames = new Map<number, AtlasFrame>();
  for (const [id, frame] of layer.atlas.frames) frames.set(id, { ...frame, offsetY: frame.offsetY + shift });
  return { ...layer, atlas: { ...layer.atlas, frames } };
}

/**
 * Load the per-job {@link SettlerCharacterSet}: every {@link import('../settler-gfx/index.js').CHARACTER_SPECS}
 * look whose body atlas and sequences resolve, joined to jobs via
 * {@link import('../settler-gfx/index.js').ADULT_CHARACTER_BY_JOB} / `YOUNG_CHARACTER_BY_JOB`. Bodies are loaded
 * once per roster entry (the six soldier looks share one armoured body atlas); a head that 404s is skipped
 * (the look draws with fewer faces), a body that 404s or an unresolvable binding drops that look (its jobs
 * fall back to the default). Returns `undefined` — no characters, the sheet degrades to the single-body
 * legacy path — when the IR carries no sequences or the civilian look (the required default) can't be built.
 */
export async function loadCharacters(
  ir: ContentIr | null,
  goods: readonly GoodRef[],
  palette: string,
): Promise<SettlerCharacterSet | undefined> {
  if (ir?.bobSequences === undefined || ir.bobSequences.length === 0) return undefined;

  const rosterById = new Map(VIKING_CHARACTERS.map((c) => [c.id, c]));
  // One load per roster body: its body layer (hard requirement per look) + its head layers (soft).
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
        // An optional look must never kill the boot: a missing body (MissingAtlasError) is the expected
        // undecoded-content case; any other failure (a corrupt manifest, a truncated PNG) is a real bug
        // — surface it loudly, but still degrade this look to the default instead of failing the whole
        // sheet. Strict propagation stays on the base sheet's own loads (loadHumanSpriteSheet).
        if (!(err instanceof MissingAtlasError)) {
          diag.warn(
            'content',
            `character look '${rosterId}' failed to load — falling back to the default look`,
            err,
          );
        }
      }
    }),
  );

  // The viking directional attack frame lists (`[gfxanimatomic]` action-81), indexed by swing bobseq
  // name — the layout each warrior/civilian spec's `attack` seq becomes a FrameListAnim from. Built once
  // (not per spec); a spec whose seq is absent just has no attack animation.
  const attackFrameLists = gfxAtomicFrameLists(ir, VIKING_ANIM_TRIBE, ATTACK_ATOMIC);
  // The per-direction frame lists for every dir-list action — gathering, field work, the builder hammer,
  // the wedding kiss and the gossip talk/listen `[gfxanimatomic]` records — keyed by atomic id: what each
  // spec's `dirListAtomics` becomes FrameListAnims from. An action missing here plays its plain `atomics`
  // strip whole, cycling through the sheet's direction blocks (the "spinning" artifact). Built once; an
  // IR without a record just leaves that action on its fallback clip.
  const actionFrameLists = new Map(
    [
      HARVEST_ATOMIC,
      STONE_HARVEST_ATOMIC,
      CLAY_HARVEST_ATOMIC,
      IRON_HARVEST_ATOMIC,
      GOLD_HARVEST_ATOMIC,
      MUSHROOM_HARVEST_ATOMIC,
      WHEAT_HARVEST_ATOMIC,
      PLANT_ATOMIC,
      CULTIVATE_ATOMIC,
      BUILD_HOUSE_ATOMIC,
      KISS_ATOMIC,
      KISSED_ATOMIC,
      TALK_ATOMIC,
      LISTEN_ATOMIC,
    ].map((action) => [action, gfxAtomicFrameLists(ir, VIKING_ANIM_TRIBE, action)] as const),
  );
  // One mushroom pick bends MUSHROOM_PLUCKS_PER_PICK times: repeat the authored one-shot pluck list
  // back-to-back so the whole pick is a single continuous motion (HARVEST_TICKS sizes the atomic to
  // cover the repeats + a ready-stance breather — settler-gfx.ts, observed-pace approximation).
  const pluck = actionFrameLists.get(MUSHROOM_HARVEST_ATOMIC);
  if (pluck !== undefined) {
    actionFrameLists.set(
      MUSHROOM_HARVEST_ATOMIC,
      new Map(
        [...pluck].map(([seq, dirs]) => {
          for (const list of dirs) {
            if (list.length !== MUSHROOM_PLUCK_FRAMES) {
              // The atomic duration is sized off the pin, not this list — a drifted extraction would
              // cut the repeated motion short or pad it; surface it instead of silently mistiming.
              diag.warn(
                'content',
                `mushroom pluck list '${seq}' is ${list.length} frames; HARVEST_TICKS is sized for ${MUSHROOM_PLUCK_FRAMES}`,
              );
            }
          }
          return [
            seq,
            dirs.map((list) => Array.from({ length: MUSHROOM_PLUCKS_PER_PICK }, () => list).flat()),
          ] as const;
        }),
      ),
    );
  }

  const bySpec = new Map<string, SettlerCharacter>();
  for (const [specId, spec] of CHARACTER_SPEC_ENTRIES) {
    const layers = layersByRoster.get(spec.rosterId);
    const roster = rosterById.get(spec.rosterId);
    if (layers === undefined || roster === undefined) continue;
    const binding = characterBinding(
      spec,
      sequencesFor(ir, roster.imagelib),
      goods,
      attackFrameLists,
      actionFrameLists,
    );
    if (binding === null) continue;
    const heads = (spec.headBmds ?? roster.headBmds)
      .map((bmd) => layers.headsByStem.get(characterStem(bmd, palette)))
      .filter((l): l is SpriteLayer => l !== undefined);
    // Head-borrow: goods whose carry cycle ships empty head bobs resolve the head through the base walk
    // instead (carryHeadAnims) — else a stone/grain hauler draws headless. All of a body's heads share
    // one bob layout, so checking the first head atlas stands for the set.
    const byGood = binding.carrying?.byGood;
    const headAtlas = heads[0]?.atlas;
    // The head-borrow reference is the plain walk (a uniform DirectionalAnim); moving is never the
    // explicit-frame-list kind (only the attack swing is), so exclude a FrameListAnim to keep the type.
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
  // The equipped-weapon look table: a warrior draws the body of the weapon in its Equipment.weapon slot.
  // Joined slug → the running content's good typeId (sandbox 137–142 vs real 37–42), so the key matches
  // whatever `Equipment.weapon.goodType` the sim actually stamps.
  const byWeaponGood: Record<number, SettlerCharacter> = {};
  for (const good of goods) {
    const specId = WARRIOR_SPEC_BY_WEAPON_GOOD_SLUG[good.id];
    if (specId === undefined) continue;
    const char = bySpec.get(specId);
    if (char !== undefined) byWeaponGood[good.typeId] = char;
  }
  return { byJob, youngByJob, byWeaponGood, default: fallback };
}
