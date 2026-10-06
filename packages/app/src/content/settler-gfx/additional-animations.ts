import type { FrameListAnim, SettlerStateBinding } from '@open-northland/render/data';
import { ATTACK_ATOMIC, EAT_ATOMIC, EAT_CANDY_ATOMIC, SLEEP_ATOMIC } from '../../catalog/atomics.js';
import type { BobSeqRow } from '../ir/rows.js';
import type { CharacterGfx } from './bindings-character.js';
import type { CharacterSpec } from './character-specs.js';
import { playableLists } from './frame-program.js';
import { eightDirAnim } from './seq-anim.js';

/** Only bare-handed looks share these action-81 variants; equipment keeps its own attack. */
const ATTACK_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  human_man_Civilian_Fight_punch: [
    'human_man_Civilian_Fight_double_punch',
    'human_man_Civilian_Fight_dragon_punch',
    'human_man_Civilian_Fight_high_kick',
  ],
  human_man_warrior_empty_punch: [
    'human_man_warrior_empty_double_punch',
    'human_man_warrior_empty_dragon_punch',
    'human_man_warrior_empty_high_kick',
  ],
};

const BOW_PREFIXES: Readonly<Record<string, string>> = {
  human_man_Warrior_Shortbow_walk: 'human_man_Warrior_Shortbow',
  human_man_Warrior_Longbow_walk: 'human_man_Warrior_Longbow',
};

/** Unbound artwork must have matching heads; keep the existing clips on incomplete tribe sheets. */
function hasOwnHeads(row: BobSeqRow, gfx: CharacterGfx): boolean {
  return (gfx.headAtlases ?? []).every((atlas) => {
    for (let offset = 0; offset < row.length; offset++) {
      const frame = atlas.frames.get(row.start + offset);
      if (frame === undefined || frame.width === 0 || frame.height === 0) return false;
    }
    return true;
  });
}

function authoredClip(
  name: string,
  actions: readonly number[],
  sequences: ReadonlyMap<string, BobSeqRow>,
  gfx: CharacterGfx,
): FrameListAnim | undefined {
  const row = sequences.get(name);
  if (row === undefined || !hasOwnHeads(row, gfx)) return undefined;
  for (const action of actions) {
    const program = gfx.programsByAction?.get(action)?.get(name) ?? gfx.basePrograms?.get(action)?.get(name);
    const lists = playableLists(program, row, gfx.bodyAtlas);
    if (lists !== undefined) return { start: row.start, frameLists: lists };
  }
  return undefined;
}

function attackChoices(
  spec: CharacterSpec,
  sequences: ReadonlyMap<string, BobSeqRow>,
  gfx: CharacterGfx,
): readonly FrameListAnim[] {
  const attack = spec.attack;
  if (attack === undefined) return [];
  const variants = ATTACK_VARIANTS[attack];
  if (variants === undefined) return [];
  return [attack, ...variants].flatMap((name) => {
    const clip = authoredClip(name, [ATTACK_ATOMIC], sequences, gfx);
    // Approximation: fit the complete gesture into the existing one-hit attack, preserving combat timing.
    return clip === undefined ? [] : [{ ...clip, spansAtomic: true }];
  });
}

/** The unbound shortbow strips retain the bow through meals and naps. Playback is an approximation:
 *  the meal reverses to its rest pose; the nap lies down, holds a breathing pose, then gets up once. */
function shortbowNeeds(
  sequences: ReadonlyMap<string, BobSeqRow>,
): NonNullable<SettlerStateBinding['byAtomic']> {
  const out: Record<number, FrameListAnim> = {};
  const eat = sequences.get('human_man_Warrior_Shortbow_eat');
  if (eat?.length === 18) {
    const forward = Array.from({ length: eat.length }, (_, i) => i);
    const meal = {
      start: eat.start,
      frameLists: [[...forward, ...forward.slice(1, -1).reverse()]],
      loop: true,
    };
    out[EAT_ATOMIC] = meal;
    out[EAT_CANDY_ATOMIC] = meal;
  }
  const sleep = sequences.get('human_man_Warrior_Shortbow_sleep');
  if (sleep?.length === 21) {
    const lieDown = Array.from({ length: sleep.length }, (_, i) => i);
    const rest = Array.from({ length: 240 }, (_, i) => 19 + (Math.floor(i / 12) % 2));
    out[SLEEP_ATOMIC] = {
      start: sleep.start,
      frameLists: [[...lieDown, ...rest, ...lieDown.slice(0, -1).reverse()]],
      spansAtomic: true,
    };
  }
  return out;
}

export function withAdditionalAnimations(
  binding: SettlerStateBinding,
  spec: CharacterSpec,
  sequences: ReadonlyMap<string, BobSeqRow>,
  gfx: CharacterGfx,
): SettlerStateBinding {
  const choices = attackChoices(spec, sequences, gfx);
  const attacks = choices.length > 1 ? { byAtomicChoices: { [ATTACK_ATOMIC]: choices } } : {};
  const prefix = spec.walkSeq === undefined ? undefined : BOW_PREFIXES[spec.walkSeq];
  if (prefix === undefined) return { ...binding, ...attacks };

  sequences = new Map([...sequences].filter(([, row]) => hasOwnHeads(row, gfx)));

  // The Viking wave is an idle action (4); other tribes bind the same artwork to cheer (17).
  const wave = authoredClip(`${prefix}_happy`, [4, 17], sequences, gfx);
  const moving = eightDirAnim(sequences, `${prefix}_walk_agressive`, gfx.walkLists);
  const stance = sequences.get(`${prefix}_wait_agressive`);
  // The bow stance has no atomic record. Its turning gesture shares the spear stance's first 28 frames;
  // borrow that authored wait program by analogy, not a division into directional blocks.
  const spearName = 'human_man_Warrior_spear_wait_agressive';
  const spearProgram =
    gfx.programsByAction?.get(6)?.get(spearName) ?? gfx.basePrograms?.get(6)?.get(spearName);
  const stanceLists = stance === undefined ? undefined : playableLists(spearProgram, stance, gfx.bodyAtlas);
  const idle =
    stance?.length === 28 &&
    stanceLists !== undefined &&
    stanceLists.every((list) => list.every((offset) => offset >= 0 && offset < stance.length))
      ? { start: stance.start, frameLists: stanceLists, loop: true }
      : undefined;
  const needs = prefix === 'human_man_Warrior_Shortbow' ? shortbowNeeds(sequences) : {};
  return {
    ...binding,
    ...attacks,
    byAtomic: { ...binding.byAtomic, ...needs },
    ...(wave !== undefined
      ? {
          idleFidgets: [wave],
          // Approximation: a wave after roughly 50 seconds of uninterrupted rest, between complete waits.
          idleFidgetGapTicks: 600,
        }
      : {}),
    ...(moving !== undefined || idle !== undefined
      ? {
          engaged: {
            ...binding.engaged,
            ...(moving !== undefined ? { moving } : {}),
            ...(idle !== undefined ? { idle } : {}),
          },
        }
      : {}),
  };
}
