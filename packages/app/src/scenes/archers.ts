import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { type Entity, type Simulation, components, fx, systems } from '@vinland/sim';
import { GRASS, VIKING, grassTerrain } from '../catalog/buildings.js';
import type { SceneDefinition } from './types.js';

const { MILITARY_MODE } = systems;

/**
 * Acceptance scene: **archers** — a line of BLUE bowmen (mixed short + long bows) holds its ground while a
 * RED sword squad of the SAME tribe (told apart by player) MARCHES across the field into the arrow storm.
 * It exercises the ranged half of combat end-to-end through the real `step()` schedule: a shot LAUNCHES a
 * projectile entity at the bow's ATTACK-event (release) frame, the arrow HOMES on its mark and deals its
 * damage on CONTACT (never instantly), and a swordsman that closes inside the bow's `minRange` dead zone
 * can no longer be shot (a bow can't fire point-blank). The archers stand and fire because a bow's sight
 * equals its long reach; the swordsmen advance under an explicit attack order (their melee sight is short).
 *
 * The headless half proves the MECHANIC mid-battle (arrows are in flight, ranged kills have already
 * happened, the bow line is unscathed) with no screen; the browser half lets a human watch the volleys
 * arc across. NOTE to the reviewer: the projectile is INVISIBLE until the render slice (step 6) draws an
 * arrow sprite — on screen today you see swordsmen advance and HP fall at a distance with nothing between
 * bow and body yet; the flight is real in the sim (the headless checks assert it), just not yet drawn.
 */

// Real jobtypes ids: short-bow soldier 40, long-bow soldier 41, short-sword soldier 34 — so the render
// `[jobbasegraphics]` join draws them as WARRIOR bodies (bow / sword), not the civilian default. The sim
// keys combat off (tribe, jobType) + the worn weapon, so the loadout binds all the same.
const BOW_JOB = 40; // the archer soldier class
const SWORD_JOB = 34; // the advancing melee class
const COIN = 3; // the good the viking tech edge unlocks (so VIKING reads as a civ, not an animal tribe)

const SHORT_BOW = 20;
const LONG_BOW = 21;
const SWORD = 7;
const ARROW = 1; // munitiontype 1
const BOW_SPEED = 8; // the real short/long-bow speed
const BOW_DAMAGE = 34;
const SWORD_DAMAGE = 40;

const BLUE = 0; // the archers
const RED = 1; // the advancing swords

const MAP_W = 40;
const MAP_H = 12;

// The frailer-per-hit but MANY swordsmen march a long way into a sustained volley: the archers whittle them
// down at range, so at the mid-battle checkpoint arrows are still in flight, several swords have already
// fallen at a distance, and the unreachable bow line is untouched. A seed-independent outcome (no RNG).
const ARCHER_HP = 240;
const SWORD_HP = 280; // tanky — survives several arrows, so the fight lasts (arrows keep flying)

const { AttackOrder, Health, Owner, Position, Projectile, Settler, Stance, Weapon } = components;

function content(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-archers-scene' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: COIN, id: 'coin' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: SWORD_JOB, id: 'swordsman' },
      { typeId: BOW_JOB, id: 'archer' },
    ],
    buildings: [],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      // Two bows a settler can hold (both bind the archer job; the worn Weapon picks one): a short bow
      // (reach 3..15) and a long bow (reach 4..23), both firing arrows at speed 8. A close-in dead zone
      // (minRange) means neither can fire at a swordsman that reaches point-blank.
      {
        typeId: SHORT_BOW,
        id: 'viking_short_bow',
        tribeType: VIKING,
        jobType: BOW_JOB,
        mainType: 6,
        munitionType: ARROW,
        speed: BOW_SPEED,
        minRange: 3,
        maxRange: 15,
        damage: { '0': BOW_DAMAGE },
      },
      {
        typeId: LONG_BOW,
        id: 'viking_long_bow',
        tribeType: VIKING,
        jobType: BOW_JOB,
        mainType: 6,
        munitionType: ARROW,
        speed: BOW_SPEED,
        minRange: 4,
        maxRange: 23,
        damage: { '0': BOW_DAMAGE },
      },
      // A short-reach melee sword (band [1,1]) — the marching squad's weapon; harmless until it closes.
      {
        typeId: SWORD,
        id: 'viking_sword',
        tribeType: VIKING,
        jobType: SWORD_JOB,
        minRange: 1,
        maxRange: 1,
        damage: { '0': SWORD_DAMAGE },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          // The archer's attack atomic (81) is a bow draw whose ATTACK event (type 25) sits at the release
          // frame 6 of 12 — the arrow is loosed THERE, mid-draw (not at completion). The swordsman's swing
          // (length 4, no event) lands at completion, the melee baseline.
          { jobType: BOW_JOB, atomicId: 81, animation: 'viking_bow_attack' },
          { jobType: SWORD_JOB, atomicId: 81, animation: 'viking_sword_attack' },
        ],
        // A tech edge so VIKING reads as a playable CIVILIZATION (not an animal tribe) — the owner axis
        // decides the fight, but the classification stays honest.
        jobEnables: [{ jobType: BOW_JOB, kind: 'good', targetId: COIN }],
      },
    ],
    atomicAnimations: [
      { id: 'viking_bow_attack', name: 'viking_bow_attack', length: 12, events: [{ at: 6, type: 25 }] },
      { id: 'viking_sword_attack', name: 'viking_sword_attack', length: 4 },
    ],
  });
}

/** A player-owned combatant of the viking tribe, wielding `weaponTypeId`, with the soldier's default
 *  (ATTACK) stance — created directly so the scene can hand the swordsmen an explicit attack order (which
 *  needs the target archer's id). Mirrors what `spawnSettler{owner,hitpoints,weaponTypeId}` stamps. */
function soldier(
  sim: Simulation,
  x: number,
  y: number,
  job: number,
  weaponTypeId: number,
  player: number,
  hp: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType: job,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(e, Health, { hitpoints: hp, max: hp });
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
  sim.world.add(e, Weapon, { weaponTypeId });
  return e;
}

// BLUE archers hold a column on the LEFT (x = ARCHER_X), alternating short/long bows down the rows. RED
// swordsmen start far on the RIGHT and each MARCHES at the archer on its row (an explicit attack order —
// their melee sight is too short to auto-spot across the field). Long bows (reach 23) open fire while the
// swords are still ~23 tiles out; the swords cross the whole field under the volley.
const ARCHER_X = 4;
const SWORD_X = 32;
const ROWS = [2, 4, 6, 8, 10] as const;

// A DEAD-ZONE vignette, isolated in the far-right corner (out of the main line's reach): a lone guard bow
// with a hostile but UNARMED enemy standing point-blank (2 tiles < the long bow's minRange 4). The guard
// can never fire on it — a bow can't shoot inside its own dead zone — so the point-blank enemy is untouched
// all battle, while the guard looses freely at the distant advancing swords. The visible proof that closing
// inside minRange stops a unit being shot.
const GUARD_AT = { x: 38, y: 0 } as const;
const POINT_BLANK_AT = { x: 36, y: 0 } as const; // dist 2 from the guard — inside its minRange-4 dead zone
const DUMMY_X_MIN = 34; // the point-blank dummy never moves; every marcher advances LEFT below this x

function build(sim: Simulation): void {
  const archers: Entity[] = [];
  ROWS.forEach((y, i) => {
    // Alternate the bow each row so the line is a MIX of short and long bows (visibly different reach).
    const bow = i % 2 === 0 ? LONG_BOW : SHORT_BOW;
    archers.push(soldier(sim, ARCHER_X, y, BOW_JOB, bow, BLUE, ARCHER_HP));
  });
  ROWS.forEach((y, i) => {
    const sword = soldier(sim, SWORD_X, y, SWORD_JOB, SWORD, RED, SWORD_HP);
    // March this swordsman at the archer on its row, regardless of sight, until that archer dies — so the
    // squad advances across the field into the arrows rather than idling out of its short melee sight.
    sim.world.add(sword, AttackOrder, { target: archers[i] as Entity });
  });

  // The dead-zone vignette: the guard bow + the point-blank unarmed enemy it can never shoot. The dummy
  // is IGNORE-stanced so it neither flees nor engages — it just stands in the guard's dead zone, untouched.
  soldier(sim, GUARD_AT.x, GUARD_AT.y, BOW_JOB, LONG_BOW, BLUE, ARCHER_HP);
  const dummy = sim.world.create();
  sim.world.add(dummy, Position, { x: fx.fromInt(POINT_BLANK_AT.x), y: fx.fromInt(POINT_BLANK_AT.y) });
  sim.world.add(dummy, Settler, {
    tribe: VIKING,
    jobType: 0, // unarmed — no weapon binds to the idle job, so it can never strike back
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  sim.world.add(dummy, Health, { hitpoints: SWORD_HP, max: SWORD_HP });
  sim.world.add(dummy, Owner, { player: RED });
  sim.world.add(dummy, Stance, { mode: MILITARY_MODE.IGNORE, anchorCell: null }); // never flee, never engage
}

/** Living combatants owned by `player`. */
function aliveOf(sim: Simulation, player: number): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player === player && sim.world.get(e, Health).hitpoints > 0) out.push(e);
  }
  return out;
}

/** The advancing RED swordsmen (marchers move LEFT past `DUMMY_X_MIN`; the point-blank dummy never does). */
function marchers(sim: Simulation): Entity[] {
  return aliveOf(sim, RED).filter((e) => fx.toInt(sim.world.get(e, Position).x) < DUMMY_X_MIN);
}

/** The point-blank dead-zone dummy (the one RED that stays in the far-right corner), if still alive. */
function pointBlankDummy(sim: Simulation): Entity | undefined {
  return aliveOf(sim, RED).find((e) => fx.toInt(sim.world.get(e, Position).x) >= DUMMY_X_MIN);
}

/** Projectiles currently in flight. */
function inFlight(sim: Simulation): number {
  return [...sim.world.query(Projectile)].length;
}

export const archersScene: SceneDefinition = {
  id: 'archers',
  title: 'Łucznicy — salwa strzał w nacierającą piechotę',
  summary:
    'Linia niebieskich łuczników (krótkie i długie łuki) stoi w miejscu, a czerwony oddział miecznikόw tej ' +
    'samej tribe (rόżni gracze) NACIERA przez całe pole w grad strzał. Strzał to POCISK wystrzelony w klatce ' +
    'wyzwolenia animacji — leci do celu i zadaje obrażenia DOPIERO po dolocie (nie natychmiast); miecznik, ' +
    'ktόry wejdzie w martwą strefę łuku (bliżej niż minRange), przestaje być ostrzeliwany. UWAGA: pocisk jest ' +
    'NIEWIDOCZNY do kroku 6 (brak sprite’a strzały) — na ekranie widać nacierających i spadające HP, sam lot ' +
    'strzały jeszcze się nie rysuje (headless-testy dowodzą, że leci).',
  seed: 4,
  content: content(),
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // A mid-battle checkpoint (empirically pinned): the swords have crossed into range, a couple have already
  // fallen to arrows, three are still advancing, and volleys are in the air — the fight isn't over (so a
  // projectile is genuinely in flight), while the bow line and the point-blank dummy are untouched.
  runTicks: 140,
  initialZoom: 1.1,
  checklist: [
    'Łucznicy STOJĄ w linii i strzelają; miecznicy NACIERAJĄ przez całe pole ku nim',
    'Miecznicy tracą HP JESZCZE zanim dojdą do zwarcia (trafienia z dystansu — strzały dolatują), i giną pod salwą',
    'W prawym rogu: strażnik-łucznik ma tuż obok WROGA (2 pola), ale go NIE ostrzeliwuje — cel jest w martwej strefie łuku',
    'Linia łuczników pozostaje nietknięta (biją z dystansu, nie w zwarciu) — wynik jest ten sam za każdym razem',
    'UWAGA: strzała jest niewidoczna do kroku 6 — widać skutek (spadające HP), nie sam lot',
  ],
  checks: [
    {
      label: 'arrows are in flight at the checkpoint (projectiles are real entities mid-flight)',
      predicate: (sim) => inFlight(sim) > 0,
    },
    {
      label:
        'ranged kills have already happened — at least one swordsman fell to arrows before reaching the line',
      predicate: (sim) => marchers(sim).length < ROWS.length,
    },
    {
      label: 'the fight is still ongoing at the checkpoint (swords still advancing under fire)',
      predicate: (sim) => marchers(sim).length > 0,
    },
    {
      label: 'the bow line is untouched — every archer is alive and unharmed (killing from range, not melee)',
      predicate: (sim) => {
        const blue = aliveOf(sim, BLUE);
        return (
          blue.length === ROWS.length + 1 &&
          blue.every((e) => sim.world.get(e, Health).hitpoints === ARCHER_HP)
        );
      },
    },
    {
      label:
        'dead zone: the enemy standing point-blank (inside minRange) is never shot — it is at full health',
      predicate: (sim) => {
        const dummy = pointBlankDummy(sim);
        return dummy !== undefined && sim.world.get(dummy, Health).hitpoints === SWORD_HP;
      },
    },
  ],
};
