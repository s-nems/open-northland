import type {
  SettlerCharacter,
  SettlerCharacterSet,
  SettlerStateBinding,
  SpriteLayer,
} from '@vinland/render';
import {
  ATTACK_ATOMIC,
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  PLANT_ATOMIC,
  STONE_HARVEST_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../catalog/atomics.js';
import { characterStem, characterStems, VIKING_CHARACTERS } from '../../catalog/roster.js';
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
  WARRIOR_SPEC_BY_WEAPON_GOOD,
  YOUNG_CHARACTER_BY_JOB,
} from '../settler-gfx/index.js';

/**
 * The viking `[gfxanimatomic]` `logictribe` — `logicdefines.inc` `TRIBE_TYPE_HUMAN_VIKING = 1`. NOT the
 * tribetypes `logicType` (also 1 for viking, but 4 there is Saracen), and NOT a value to guess: the same
 * body bobseq name recurs across the human tribes with DIFFERENT per-direction frame lists, so the attack
 * swings must be drawn from THIS tribe's records (`gfxAtomicFrameLists`), else a soldier swings a
 * different tribe's motion. See the scoped-id gotcha in the root AGENTS.md.
 */
const VIKING_ANIM_TRIBE = 1;

/**
 * Load the per-job {@link SettlerCharacterSet}: every {@link import('../settler-gfx/index.js').CHARACTER_SPECS}
 * look whose body atlas AND sequences resolve, joined to jobs via
 * {@link import('../settler-gfx/index.js').ADULT_CHARACTER_BY_JOB} / `YOUNG_CHARACTER_BY_JOB`. Bodies are loaded
 * once per roster entry (the six soldier looks share one armoured body atlas); a head that 404s is skipped
 * (the look draws with fewer faces), a BODY that 404s or an unresolvable binding drops that look (its jobs
 * fall back to the default). Returns `undefined` — no characters, the sheet degrades to the single-body
 * legacy path — when the IR carries no sequences or the CIVILIAN look (the required default) can't be built.
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
        // An OPTIONAL look must never kill the boot: a missing body (MissingAtlasError) is the expected
        // undecoded-content case; any other failure (a corrupt manifest, a truncated PNG) is a real bug
        // — surface it loudly, but still degrade this look to the default instead of failing the whole
        // sheet. Strict propagation stays on the BASE sheet's own loads (loadHumanSpriteSheet).
        if (!(err instanceof MissingAtlasError)) {
          console.warn(`character look '${rosterId}' failed to load — falling back to the default look`, err);
        }
      }
    }),
  );

  // The viking directional attack frame lists (`[gfxanimatomic]` action-81), indexed by swing bobseq
  // name — the layout each warrior/civilian spec's `attack` seq becomes a FrameListAnim from. Built once
  // (not per spec); a spec whose seq is absent just has no attack animation.
  const attackFrameLists = gfxAtomicFrameLists(ir, VIKING_ANIM_TRIBE, ATTACK_ATOMIC);
  // The gathering + field-work frame lists (the collector job-8 chop/dig/pluck and the farmer job-18
  // sow/water/reap `[gfxanimatomic]` records), keyed by atomic id — what each spec's `dirListAtomics`
  // becomes FrameListAnims from (the attack mechanism generalized). Built once; an IR without them just
  // leaves those actions on their fallback clips.
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
              // The atomic duration is sized off the PIN, not this list — a drifted extraction would
              // cut the repeated motion short or pad it; surface it instead of silently mistiming.
              console.warn(
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
    // Head-borrow: goods whose carry cycle ships empty head bobs resolve the HEAD through the base walk
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
      body: layers.body,
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
  const byWeaponGood: Record<number, SettlerCharacter> = {};
  for (const [good, specId] of Object.entries(WARRIOR_SPEC_BY_WEAPON_GOOD)) {
    const char = bySpec.get(specId);
    if (char !== undefined) byWeaponGood[Number(good)] = char;
  }
  return { byJob, youngByJob, byWeaponGood, default: fallback };
}
