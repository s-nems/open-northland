import {
  frameOf,
  type SettlerCharacter,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteFrameRef,
} from '@open-northland/render';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  ATTACK_ATOMIC,
  BUILD_HOUSE_ATOMIC,
  BUILD_ROAD_ATOMIC,
  BUILD_WALL_ATOMIC,
  CHEER_ATOMIC,
} from '../../src/catalog/atomics.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_CIVILIST,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_UNARMED,
  JOB_TRADER,
  SOLDIER_JOB_MAX,
} from '../../src/catalog/jobs.js';
import { BYZANTINE_SPEAR_VARIANTS } from '../../src/catalog/unit-variants.js';
import { humanSequences } from '../../src/content/ir/joins.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { FACING } from '../../src/content/settler-gfx/index.js';
import { withPlayableCharacters } from '../../src/content/sprite-sheet/unit-variants.js';
import type { WorldTribes } from '../../src/game/world-tribes.js';
import { byzantineSpearsScene } from '../../src/scenes/byzantine-spears.js';
import { combatGesturesScene } from '../../src/scenes/combat-gestures.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { characterTablesUnderTest, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Every frame a civilization's settler looks can play draws a whole figure on the REAL decoded content:
 * where the body draws, each head look overlays it. A clip the source overlays with another head clip
 * (`gfxbobseqhead`) reads that clip, or the frankish spearman and the frankish and byzantine archers walk
 * headless. A clip a head set authors no frames for borrows them from another head on the body, or the
 * frankish, saracen and byzantine women kiss headless.
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
 * Indoor clips attached to the shared civilian body but unused by these jobs.
 * Each pattern matches `tribe <id> <look>: <slot>`.
 */
const UNUSED_INDOOR_CLIPS: readonly RegExp[] = [
  // Other trades' indoor clips are unused by the scout/druid. Brewing must have a complete head.
  /^tribe 1 job 27: sub-clip /,
  /^tribe 1 job 30: sub-clip (?!4\/0$)/,
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
  for (const [id, choices] of Object.entries(body.byAtomicChoices ?? {})) {
    for (const [i, ref] of choices.entries()) {
      yield [`atomic ${id} choice ${i}`, ref, head.byAtomicChoices?.[Number(id)]?.[i] ?? ref];
    }
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

  it('draws the Byzantine wooden spear as a dragon and the iron spear as a headed soldier', () => {
    const table = tables.get(BYZANTINE);
    const wooden = table?.byJob[JOB_SOLDIER_SPEAR_WOODEN];
    const iron = table?.byJob[JOB_SOLDIER_SPEAR];
    // CNMod jobgraphics.ini names body 72 for job 32, body 52 with heads 53/54 for job 33.
    expect(wooden?.heads ?? []).toHaveLength(0);
    expect(iron?.heads).toHaveLength(2);
    // The authored bobseq starts distinguish both the gait and the swing, not just the atlas.
    expect(wooden?.binding.moving).toMatchObject({ start: 586 });
    expect(wooden?.binding.byAtomic?.[ATTACK_ATOMIC]).toMatchObject({ start: 0 });
    expect(iron?.binding.moving).toMatchObject({ start: 2672 });
    expect(iron?.binding.byAtomic?.[ATTACK_ATOMIC]).toMatchObject({ start: 2255 });
    const ir = rawIrUnderTest() as ContentIr;
    for (const [slug, character] of [
      ['spear_wooden', wooden],
      ['spear_iron', iron],
    ] as const) {
      const good = ir.goods?.find((row) => row.id === slug);
      if (good === undefined) throw new Error(`missing ${slug}`);
      expect(table?.byWeaponGood?.[good.typeId]).toBe(character);
    }
  });

  it('gives the playable wooden spear the complete human look while retaining scenario dragons', () => {
    const raw = tables.get(BYZANTINE);
    if (raw === undefined) throw new Error('missing Byzantine table');
    const table = withPlayableCharacters(raw, BYZANTINE_SPEAR_VARIANTS);
    const playable = table.playable?.byJob[JOB_SOLDIER_SPEAR_WOODEN];
    const iron = raw.byJob[JOB_SOLDIER_SPEAR];
    expect(playable?.body).toBe(iron?.body);
    expect(playable?.binding).toBe(iron?.binding);
    expect(playable?.heads).toHaveLength(2);
    expect(playable?.paletteJobType).toBe(JOB_SOLDIER_SPEAR);
    expect(table.byJob[JOB_SOLDIER_SPEAR_WOODEN]?.heads ?? []).toHaveLength(0);
    const good = (rawIrUnderTest() as ContentIr).goods?.find((row) => row.id === 'spear_wooden');
    if (good === undefined) throw new Error('missing wooden spear');
    expect(table.playable?.byWeaponGood?.[good.typeId]).toBe(playable);
  });

  it('spawns both spear forms together using the generated catalog and authored slot roles', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(byzantineSpearsScene, { content: merge.content });
    sim.step();
    const units = [...sim.world.query(components.Settler, components.Owner, components.Health)];
    expect(units).toHaveLength(6);
    for (const e of units) {
      const identity = sim.world.get(e, components.Settler);
      const owner = sim.world.get(e, components.Owner).player;
      const dragon = owner === 2 && identity.jobType === JOB_SOLDIER_SPEAR_WOODEN;
      expect(sim.world.get(e, components.Health).max, `owner ${owner}, job ${identity.jobType}`).toBe(
        dragon ? 20000 : 5000,
      );
    }
  });

  it('reaches the new actions through normal commands with generated content', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(combatGesturesScene, { content: merge.content });
    const reached = new Set<string>();
    let wedding = false;
    for (let tick = 0; tick < 300; tick++) {
      sim.step();
      for (const _e of sim.world.query(components.Marriage)) wedding = true;
      for (const e of sim.world.query(components.Settler, components.CurrentAtomic)) {
        const job = sim.world.get(e, components.Settler).jobType;
        const action = sim.world.get(e, components.CurrentAtomic).atomicId;
        if (job === JOB_CIVILIST && action === CHEER_ATOMIC) expect(wedding).toBe(true);
        if (job === JOB_BUILDER && action === ATTACK_ATOMIC) {
          expect(sim.world.has(e, components.Weapon)).toBe(false);
          expect(sim.world.get(e, components.CurrentAtomic)).toMatchObject({
            duration: 16,
            effect: { kind: 'attack', hitFrames: [6] },
          });
        }
        reached.add(`${job}:${action}`);
      }
    }
    for (const action of ['7:81', '31:81', '40:10', '40:8', '6:17'])
      expect(reached.has(action), action).toBe(true);
  });

  it('makes the additional civilian and unarmed attacks reachable, without changing armed attacks', () => {
    const table = tables.get(VIKING);
    const starts = (job: number) =>
      (table?.byJob[job] ?? table?.default)?.binding.byAtomicChoices?.[ATTACK_ATOMIC]?.map(
        (clip) => clip.start,
      );
    // Pinned bobseq ranges in the supplied animation table.
    expect(starts(JOB_CIVILIST)).toEqual([425, 95, 221, 323]);
    expect(starts(JOB_SOLDIER_UNARMED)).toEqual([998, 632, 758, 877]);
    expect(starts(JOB_ARCHER)).toBeUndefined();
    expect(starts(JOB_ARCHER_LONG)).toBeUndefined();
  });

  it('binds the civilian wedding jump to the celebration action', () => {
    const table = tables.get(VIKING);
    expect((table?.byJob[JOB_CIVILIST] ?? table?.default)?.binding.byAtomic?.[CHEER_ATOMIC]).toMatchObject({
      start: 1547,
      spansAtomic: true,
    });
  });

  it('gives each bow its own wave and combat gait, and retains the short bow during meals and naps', () => {
    const table = tables.get(VIKING);
    const short = table?.byJob[JOB_ARCHER]?.binding;
    const long = table?.byJob[JOB_ARCHER_LONG]?.binding;
    expect(short?.idleFidgets?.map((clip) => clip.start)).toContain(1950);
    expect(long?.idleFidgets?.map((clip) => clip.start)).toContain(1459);
    expect(short?.idleFidgets).toHaveLength(1);
    expect(long?.idleFidgets).toHaveLength(1);
    expect(short?.idleChoices?.length).toBeGreaterThan(0);
    expect(long?.idleChoices?.length).toBeGreaterThan(0);
    expect(short?.idleFidgetGapTicks).toBe(600);
    expect(long?.idleFidgetGapTicks).toBe(600);
    expect(short?.engaged?.idle).toMatchObject({ start: 2035 });
    expect(short?.engaged?.moving).toMatchObject({ start: 2159 });
    expect(long?.engaged?.idle).toMatchObject({ start: 1544 });
    expect(long?.engaged?.moving).toMatchObject({ start: 1668 });
    expect(short?.byAtomic?.[10]).toMatchObject({ start: 1932 });
    expect(short?.byAtomic?.[11]).toMatchObject({ start: 1932 });
    const sleep = short?.byAtomic?.[8];
    expect(sleep).toMatchObject({ start: 1986, spansAtomic: true });
    if (typeof sleep !== 'object' || !('frameLists' in sleep)) throw new Error('missing shortbow nap');
    const frames = sleep.frameLists[0] ?? [];
    expect(frames.slice(0, 21)).toEqual(Array.from({ length: 21 }, (_, i) => i));
    expect(new Set(frames.slice(21, -20))).toEqual(new Set([19, 20]));
    expect(frames.slice(-20)).toEqual(Array.from({ length: 20 }, (_, i) => 19 - i));
  });

  it('overlays a head on every body frame each look can play', () => {
    const gaps: string[] = [];
    // A look a civilization borrows from the base is checked once, under the base.
    const checked = new Set<SettlerCharacter>();
    const allTribes = characterTablesUnderTest([...CIVILIZATIONS, WERESNAKE, WEREWOLF]);
    expect(allTribes?.size).toBe(7);
    for (const [tribe, table] of allTribes ?? []) {
      expect(table, `tribe ${tribe}`).toBeDefined();
      if (table === undefined) continue;
      const looks = new Map<SettlerCharacter, string>();
      const label = (key: string, char: SettlerCharacter | undefined): void => {
        if (char !== undefined && !checked.has(char)) {
          checked.add(char);
          looks.set(char, key);
          for (const [i, variant] of (char.variants ?? []).entries()) label(`${key} variant ${i}`, variant);
        }
      };
      label('default', table.default);
      for (const [job, char] of Object.entries(table.byJob)) label(`job ${job}`, char);
      for (const [job, char] of Object.entries(table.youngByJob ?? {})) label(`young job ${job}`, char);
      for (const [job, char] of Object.entries(table.fixedByJob ?? {})) label(`fixed job ${job}`, char);
      for (const [good, char] of Object.entries(table.byWeaponGood ?? {})) label(`weapon ${good}`, char);
      for (const [job, char] of Object.entries(table.unarmedByJob ?? {})) label(`unarmed job ${job}`, char);
      for (const [char, key] of looks) {
        for (const slot of headlessSlots(char)) gaps.push(`tribe ${tribe} ${key}: ${slot}`);
      }
    }
    expect(gaps.filter((gap) => !UNUSED_INDOOR_CLIPS.some((known) => known.test(gap)))).toEqual([]);
  });

  it("drives each civilization's carts under its own trader heads", () => {
    for (const [tribe, table] of tables) {
      const trader = table?.byJob[JOB_TRADER];
      const figure = trader?.binding.cartDrive !== undefined ? trader : trader?.cartDriver;
      const drives = Object.entries(figure?.binding.cartDrive ?? {});
      expect(drives, `tribe ${tribe}`).toHaveLength(2);
      if (tribe !== VIKING) {
        // The tribe's own head sheets, never the base tribe's that the driving body comes from.
        expect(figure?.heads?.length, `tribe ${tribe}`).toBe(trader?.heads?.length);
        for (const [i, head] of (figure?.heads ?? []).entries())
          expect(head.source, `tribe ${tribe} head ${i}`).toBe(trader?.heads?.[i]?.source);
      }
      for (const [type, drive] of drives) {
        for (const ref of [drive.idle, drive.moving]) {
          for (let facing = 0; facing < FACINGS; facing++) {
            for (const clock of clocks(ref, facing)) {
              const bob = frameOf(ref, facing, clock);
              for (const head of figure?.heads ?? []) {
                expect(draws(head.atlas, bob), `tribe ${tribe} cart ${type} bob ${bob}`).toBe(true);
              }
            }
          }
        }
      }
    }
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

  it('keeps rare gestures out of continuous wait schedules', () => {
    const backToBack: string[] = [];
    for (const [tribe, table] of tables) {
      const slots = {
        default: { look: table?.default },
        job: table?.byJob,
        'young job': table?.youngByJob,
        weapon: table?.byWeaponGood,
        'unarmed job': table?.unarmedByJob,
      };
      for (const [slot, looks] of Object.entries(slots)) {
        for (const [key, char] of Object.entries(looks ?? {})) {
          const variants = [char, ...(char?.variants ?? [])];
          if (
            variants.some((look) => {
              const binding = look?.binding;
              if (binding?.idleChoices === undefined) return false;
              const fidgets = binding.idleFidgets ?? [];
              // A continuous schedule may contain ordinary waits, but must leave the rare gesture
              // on its own clock, with the moving base wait still included in the schedule.
              return (
                !binding.idleChoices.some((wait) => wait === binding.idle) ||
                fidgets.length === 0 ||
                (binding.idleFidgetGapTicks ?? 0) < 600 ||
                binding.idleChoices.some((wait) => fidgets.some((gesture) => gesture.start === wait.start))
              );
            })
          ) {
            backToBack.push(`tribe ${tribe} ${slot} ${key}`);
          }
        }
      }
    }
    expect(backToBack).toEqual([]);
  });

  it('swings the hammer per facing across every build atomic, a road site and a wall segment included', () => {
    for (const [tribe, table] of tables) {
      const builder = table?.byJob[JOB_BUILDER] ?? table?.default;
      const house = builder?.binding.byAtomic?.[BUILD_HOUSE_ATOMIC];
      for (const atomic of [BUILD_HOUSE_ATOMIC, BUILD_ROAD_ATOMIC, BUILD_WALL_ATOMIC]) {
        const swing = builder?.binding.byAtomic?.[atomic];
        if (swing === undefined || typeof swing === 'number' || !('frameLists' in swing)) {
          throw new Error(`tribe ${tribe} builder binds no hammer frame lists for atomic ${atomic}`);
        }
        expect(swing.spansAtomic, `tribe ${tribe} atomic ${atomic}`).toBe(true);
        expect(swing, `tribe ${tribe} atomic ${atomic}`).toEqual(house);
      }
    }
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
