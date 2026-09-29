import {
  frameOf,
  type SettlerCharacter,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteFrameRef,
} from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { ATTACK_ATOMIC } from '../../src/catalog/atomics.js';
import {
  JOB_ARCHER_LONG,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_UNARMED,
  SOLDIER_JOB_MAX,
} from '../../src/catalog/jobs.js';
import { humanSequences } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { FACING } from '../../src/content/settler-gfx/index.js';
import type { WorldTribes } from '../../src/game/world-tribes.js';
import { characterTablesUnderTest, hasRealIr, rawIrUnderTest } from './helpers.js';

/**
 * Every frame a civilization's settler looks can play draws a whole figure on the REAL decoded content:
 * where the body draws, each head look overlays it. A clip the source overlays with another head clip
 * (`gfxbobseqhead`) reads that clip, or the frankish spearman and the frankish and byzantine archers walk
 * headless.
 */

/** The `TRIBE_TYPE_HUMAN_*` civilizations, viking leading as the base. */
const CIVILIZATIONS: WorldTribes = [1, 2, 3, 4, 7];
const VIKING = 1;
const FRANK = 2;
const BYZANTINE = 3;
/** The monster tribes, whose soldiers are their only human look. */
const WERESNAKE = 5;
const WEREWOLF = 6;
const FACINGS = 8;
/** Every weapon-carrying soldier and hero job: the soldier band past the unarmed base, then the armed heroes. */
const ARMED_JOBS: readonly number[] = [
  ...Array.from({ length: SOLDIER_JOB_MAX - JOB_SOLDIER_UNARMED }, (_, i) => JOB_SOLDIER_UNARMED + 1 + i),
  ...Array.from({ length: JOB_HEROINE_BOW - JOB_HERO_UNARMED }, (_, i) => JOB_HERO_UNARMED + 1 + i),
];

/**
 * Head looks the source authors no frames for. Original behavior, unconfirmed in the running game: it draws
 * them headless too. Each pattern matches `tribe <id> <look>: <slot>`.
 */
const SOURCE_HEADLESS: readonly RegExp[] = [
  // The scout's and the druid's hats: other trades' indoor clips, which neither plays, and the scout's brawl.
  /^tribe 1 job (27|30): sub-clip /,
  /^tribe 1 job 27: atomic 81$/,
  // The frankish, byzantine and saracen women kiss headless, and the byzantine woman sleeps so.
  /^tribe [234] job 5: atomic 2[01]$/,
  /^tribe 3 job 5: atomic 8$/,
  // One of two civilian head looks each: the byzantine clay dig, the saracen woodcut, the egyptian brawl.
  /^tribe 3 (default|job 25): atomic 26$/,
  /^tribe 4 (default|job 25): atomic 24$/,
  /^tribe 7 (default|job (22|25|27|30)): atomic 81$/,
];

/** Each slot's body clip beside the head clip its overlay reads, by slot name. */
function* clipPairs(
  body: SettlerStateBinding,
  head: SettlerStateBinding,
): Generator<readonly [string, SpriteFrameRef, SpriteFrameRef]> {
  yield ['idle', body.idle, head.idle];
  for (const [i, ref] of (body.idleFidgets ?? []).entries()) {
    yield [`idle fidget ${i}`, ref, head.idleFidgets?.[i] ?? ref];
  }
  for (const [i, ref] of (body.idleChoices ?? []).entries()) {
    yield [`idle choice ${i}`, ref, head.idleChoices?.[i] ?? ref];
  }
  if (body.moving !== undefined) yield ['moving', body.moving, head.moving ?? body.moving];
  for (const [id, ref] of Object.entries(body.byAtomic ?? {})) {
    yield [`atomic ${id}`, ref, head.byAtomic?.[Number(id)] ?? ref];
  }
  for (const [key, ref] of Object.entries(body.bySubClip ?? {})) {
    yield [`sub-clip ${key}`, ref, head.bySubClip?.[key] ?? ref];
  }
  for (const slot of ['idle', 'moving'] as const) {
    const engaged = body.engaged?.[slot];
    if (engaged !== undefined) yield [`engaged ${slot}`, engaged, head.engaged?.[slot] ?? engaged];
    const carry = body.carrying?.[slot];
    if (carry !== undefined) yield [`carrying ${slot}`, carry, head.carrying?.[slot] ?? carry];
    for (const [good, loaded] of Object.entries(body.carrying?.byGood ?? {})) {
      const ref = loaded[slot];
      if (ref === undefined) continue;
      yield [`carrying good ${good} ${slot}`, ref, head.carrying?.byGood?.[Number(good)]?.[slot] ?? ref];
    }
  }
}

/** One play of `ref` at `facing`, as the clocks that step it frame by frame. */
function clocks(ref: SpriteFrameRef, facing: number): number[] {
  if (typeof ref === 'number') return [0];
  const perFrame = ref.ticksPerFrame ?? 1;
  const steps =
    'frameLists' in ref
      ? (ref.frameLists[facing % Math.max(1, ref.frameLists.length)]?.length ?? 1)
      : (ref.frameDurations?.reduce((sum, hold) => sum + hold, 0) ?? ref.frames ?? ref.stride);
  return Array.from({ length: Math.max(1, steps) }, (_, step) => step * perFrame);
}

function draws(atlas: SpriteAtlas, bob: number): boolean {
  const frame = atlas.frames.get(bob);
  return frame !== undefined && frame.width > 0 && frame.height > 0;
}

/** The slots of `char` where the body draws a frame one of its heads leaves empty. A head set drawing
 *  nothing at all is a body-only look's, such as the baby's, whose head is part of the body. */
function headlessSlots(char: SettlerCharacter): Set<string> {
  const heads = (char.heads ?? []).filter((head) =>
    [...head.atlas.frames.keys()].some((bob) => draws(head.atlas, bob)),
  );
  const gaps = new Set<string>();
  if (heads.length === 0) return gaps;
  for (const [slot, bodyRef, headRef] of clipPairs(char.binding, char.headBinding ?? char.binding)) {
    for (let facing = 0; facing < FACINGS; facing++) {
      for (const clock of clocks(bodyRef, facing)) {
        if (!draws(char.body.atlas, frameOf(bodyRef, facing, clock))) continue;
        const headBob = frameOf(headRef, facing, clock);
        if (heads.some((head) => !draws(head.atlas, headBob))) gaps.add(slot);
      }
    }
  }
  return gaps;
}

describe.runIf(hasRealIr())('every settler look draws its head', () => {
  const tables = characterTablesUnderTest(CIVILIZATIONS);
  if (tables === null) return;

  it('overlays a head on every body frame each look can play', () => {
    const gaps: string[] = [];
    // A look a civilization borrows from the base is checked once, under the base.
    const checked = new Set<SettlerCharacter>();
    for (const [tribe, table] of tables) {
      if (table === undefined) continue;
      const looks = new Map<SettlerCharacter, string>();
      const label = (key: string, char: SettlerCharacter | undefined): void => {
        if (char !== undefined && !checked.has(char)) {
          checked.add(char);
          looks.set(char, key);
        }
      };
      label('default', table.default);
      for (const [job, char] of Object.entries(table.byJob)) label(`job ${job}`, char);
      for (const [job, char] of Object.entries(table.youngByJob ?? {})) label(`young job ${job}`, char);
      for (const [good, char] of Object.entries(table.byWeaponGood ?? {})) label(`weapon ${good}`, char);
      for (const [job, char] of Object.entries(table.unarmedByJob ?? {})) label(`unarmed job ${job}`, char);
      for (const [char, key] of looks) {
        for (const slot of headlessSlots(char)) gaps.push(`tribe ${tribe} ${key}: ${slot}`);
      }
    }
    expect(gaps.filter((gap) => !SOURCE_HEADLESS.some((known) => known.test(gap)))).toEqual([]);
  });

  it('swings the unarmed punch and the longbow shot at N and S out of their own clip', () => {
    // Both records lay those facings past or across the clip's blocks, into the sleep and the meal.
    for (const job of [JOB_SOLDIER_UNARMED, JOB_ARCHER_LONG]) {
      const swing = tables.get(VIKING)?.byJob[job]?.binding.byAtomic?.[ATTACK_ATOMIC];
      if (swing === undefined || typeof swing === 'number' || !('frameLists' in swing)) {
        throw new Error(`viking job ${job} binds no attack frame lists`);
      }
      expect(swing.frameLists[FACING.S], `job ${job} S`).toEqual(swing.frameLists[FACING.SE]);
      expect(swing.frameLists[FACING.N], `job ${job} N`).toEqual(swing.frameLists[FACING.NW]);
    }
  });

  it('binds the longbow shot on the frankish and byzantine longbowmen', () => {
    // Their body leaves the offsets the slipped S list reads blank, which once dropped the whole program.
    for (const tribe of [FRANK, BYZANTINE]) {
      const look = tables.get(tribe)?.byJob[JOB_ARCHER_LONG];
      expect(look?.binding.byAtomic?.[ATTACK_ATOMIC], `tribe ${tribe}`).toBeDefined();
    }
  });

  it('keeps every armed look on its weapon while it fidgets', () => {
    // Each weapon class degrades through the unarmed soldier, whose idle records name the empty-handed wait.
    // A look already standing in that wait authors no armed clip at all, such as a non-viking axe hero.
    const empty = humanSequences(rawIrUnderTest() as ContentIr).get('human_man_warrior_empty_wait');
    expect(empty).toBeDefined();
    const unarmedFidgets: string[] = [];
    for (const [tribe, table] of tables) {
      const armed = [
        ...ARMED_JOBS.map((job) => [`job ${job}`, table?.byJob[job]] as const),
        ...Object.entries(table?.byWeaponGood ?? {}).map(([good, char]) => [`weapon ${good}`, char] as const),
      ];
      for (const [key, char] of armed) {
        const idle = char?.binding.idle;
        if (typeof idle === 'object' && idle.start === empty?.start) continue;
        for (const fidget of char?.binding.idleFidgets ?? []) {
          if (fidget.start === empty?.start) unarmedFidgets.push(`tribe ${tribe} ${key}`);
        }
      }
    }
    expect(unarmedFidgets).toEqual([]);
  });

  it('draws a viking carrying stone under the stooped head the source names for it', () => {
    const ir = rawIrUnderTest() as ContentIr;
    const stone = (ir.goods ?? []).find((good) => good.id === 'stone');
    const stooped = humanSequences(ir).get('human_man_generic_walk_iron_gold');
    const carry = stone === undefined ? undefined : tables.get(VIKING)?.default.headBinding?.carrying?.byGood;
    const moving = stone === undefined ? undefined : carry?.[stone.typeId]?.moving;
    expect(typeof moving === 'object' ? moving.start : undefined).toBe(stooped?.start);
  });
});

describe.runIf(hasRealIr())('the monster tribes swing their own fight', () => {
  const tables = characterTablesUnderTest([VIKING, WERESNAKE, WEREWOLF]);
  if (tables === null) return;

  it('binds the weresnake and werewolf attack, the werewolf by the weresnake clip its record names', () => {
    for (const tribe of [WERESNAKE, WEREWOLF]) {
      const look = tables.get(tribe)?.byJob[JOB_SOLDIER_UNARMED];
      expect(look?.binding.byAtomic?.[ATTACK_ATOMIC], `tribe ${tribe}`).toBeDefined();
    }
  });
});
