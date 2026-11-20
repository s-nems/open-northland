import type { MapVariantInput } from './schema.js';
import { SPECJALNA_FORTECA_RAGNAROK_BRIEFING } from './specjalna-forteca-ragnarok-briefing.js';

/** Mieszkańcy równiny and Górale, the two villages the authored map hands to whoever reaches them. */
const PLAIN_SEAT = 4;
const HIGHLAND_SEAT = 5;
/** The fortress seat and its keep: the `frank castle` the map's own AI rows test for at this point. */
const FORTRESS_SEAT = 6;
const KEEP = { building: 'barracks', x: 250, y: 243, range: 10 };
/** The tribe and trades the map's own `CreateCreatures` lines spawn the fortress's men as. */
const FORTRESS_TRIBE = 'frank';
const SWORD_LONG = 'soldier_sword_long';
const SWORD_SHORT = 'soldier_sword_short';
const BOW_LONG = 'soldier_bow_long';
const BOW_SHORT = 'soldier_bow_short';
const SPEAR_WOODEN = 'soldier_spear_wooden';
const SPEAR_IRON = 'soldier_spear_iron';

/** Each player seat, the raider camp the map sends against it, and the seat's headquarters point that
 *  camp's authored Attack task names. `landings` are the seat's sea landings, one per
 *  ship of a wave, on different stretches of its coast: a sea node in the map's edge band the ship
 *  appears on, and a shore node a small ship can dock at from the open sea, on the headquarters' own
 *  land and nearer it than any other seat's. The first is the shore nearest the headquarters. */
const RAIDS = [
  {
    seat: 0,
    raider: 7,
    x: 407,
    y: 263,
    landings: [
      { spawnX: 490, spawnY: 219, x: 481, y: 263 },
      { spawnX: 490, spawnY: 168, x: 455, y: 168 },
      { spawnX: 490, spawnY: 374, x: 461, y: 375 },
      { spawnX: 490, spawnY: 187, x: 475, y: 187 },
      { spawnX: 490, spawnY: 330, x: 484, y: 330 },
    ],
  },
  {
    seat: 1,
    raider: 8,
    x: 129,
    y: 203,
    landings: [
      { spawnX: 9, spawnY: 169, x: 65, y: 169 },
      { spawnX: 9, spawnY: 223, x: 27, y: 224 },
      { spawnX: 9, spawnY: 93, x: 65, y: 93 },
      { spawnX: 9, spawnY: 186, x: 44, y: 186 },
      { spawnX: 9, spawnY: 297, x: 28, y: 297 },
    ],
  },
  {
    seat: 2,
    raider: 9,
    x: 348,
    y: 159,
    landings: [
      { spawnX: 351, spawnY: 9, x: 386, y: 84 },
      { spawnX: 490, spawnY: 152, x: 453, y: 152 },
      { spawnX: 367, spawnY: 9, x: 367, y: 32 },
      { spawnX: 404, spawnY: 9, x: 404, y: 44 },
      { spawnX: 490, spawnY: 112, x: 452, y: 112 },
    ],
  },
  {
    seat: 3,
    raider: 10,
    x: 138,
    y: 385,
    landings: [
      { spawnX: 85, spawnY: 490, x: 108, y: 443 },
      { spawnX: 9, spawnY: 385, x: 61, y: 385 },
      { spawnX: 165, spawnY: 490, x: 198, y: 419 },
      { spawnX: 9, spawnY: 421, x: 68, y: 421 },
      { spawnX: 201, spawnY: 490, x: 201, y: 451 },
    ],
  },
  {
    seat: 4,
    raider: 11,
    x: 248,
    y: 120,
    landings: [
      { spawnX: 213, spawnY: 9, x: 256, y: 103 },
      { spawnX: 179, spawnY: 9, x: 180, y: 48 },
      { spawnX: 288, spawnY: 9, x: 288, y: 30 },
      { spawnX: 322, spawnY: 9, x: 322, y: 18 },
      { spawnX: 147, spawnY: 9, x: 147, y: 34 },
    ],
  },
  {
    seat: 5,
    raider: 12,
    x: 310,
    y: 375,
    landings: [
      { spawnX: 271, spawnY: 490, x: 294, y: 437 },
      { spawnX: 356, spawnY: 490, x: 368, y: 461 },
      { spawnX: 238, spawnY: 490, x: 243, y: 475 },
      { spawnX: 298, spawnY: 490, x: 298, y: 467 },
      { spawnX: 345, spawnY: 490, x: 345, y: 475 },
    ],
  },
];
const RAIDER_SEATS = RAIDS.map((raid) => raid.raider);
const FORTRESS_BUILDERS = 8;
const FORTRESS_PORTERS = 3;
/** The porters' flag area around the keep, in Manhattan half-cell nodes: the farthest palisade lies 68
 *  away, and the rest reaches the heaps a fight leaves just outside the gates. */
const PORTER_RADIUS = 76;

/** Defend posts on open ground around the keep, inside its inner ring of towers, uncapped, so the
 *  growing guard stands in the fortress. */
const INNER_POSTS = [
  { x: 250, y: 232 },
  { x: 258, y: 250 },
  { x: 244, y: 250 },
  { x: 236, y: 236 },
];
const INNER_POST_PRIORITY = 5;
const INNER_POST_RANGE = 12;
/** The condition reference that always holds (`[AIData]`). */
const ALWAYS = 100000;

/** The fortress side's gear, by content good slug: the better weapon of each class, the light and heavy
 *  armor pairs, the four combat amulets and the large healing draught. Every soldier gets one amulet and
 *  this share a second, different one. */
const BETTER_WEAPONS = [
  { from: 'spear_wooden', to: 'spear_iron' },
  { from: 'bow_short', to: 'bow_long' },
  { from: 'sword_shord', to: 'sword_long' },
];
const LIGHT_ARMOR = ['armor_wool', 'armor_leather'];
const HEAVY_ARMOR = ['armor_chain', 'armor_plate'];
const COMBAT_AMULETS = ['amulet_strength', 'amulet_defense', 'amulet_speed', 'amulet_crithit'];
const SECOND_AMULET_CHANCE_PCT = 30;
/** Owner ruling: only every other soldier gets the healing draught. */
const HEAL_DRAUGHT_CHANCE_PCT = 50;
/** How long a lost fortress catapult stays gone. */
const CATAPULT_RESPAWN_MINUTES = 10;

/** Owner ruling: every fortress tower holds four short and four long bows, a tower with fewer posts as
 *  many as it has. */
const TOWER_ARCHERS_PER_BOW = 4;

/** Lord Uzurpator, the keep's one-time defender: a long-sword Frank in plate with three combat amulets.
 *  His name and the siege's notices go into the map's string table under ids past the map's own. */
const LORD_HITPOINTS = 30000;
const LORD_NAME_STRING_ID = 90001;
const ATTACK_TITLE_STRING_ID = 90002;
const LANDING_TITLE_STRING_ID = 90003;
const REINFORCEMENTS_TITLE_STRING_ID = 90004;
const REINFORCEMENTS_DETAIL_STRING_ID = 90005;
/** The one title every gear step's notice shares. */
const STRONGER_TITLE_STRING_ID = 90006;
const LIGHT_ARMOR_DETAIL_STRING_ID = 90007;
const HEAVY_ARMOR_DETAIL_STRING_ID = 90008;
const AMULETS_DETAIL_STRING_ID = 90009;
const HEAL_DRAUGHTS_DETAIL_STRING_ID = 90010;
/** Owner ruling: the lord stands a fifth taller than his men. */
const LORD_SCALE_PCT = 120;
const LORD_EQUIPMENT = ['sword_long', 'armor_plate', 'amulet_strength', 'amulet_defense', 'amulet_crithit'];
const LORD_NAME = {
  pol: 'Lord Uzurpator',
  eng: 'Lord Usurper',
  ger: 'Lord Usurpator',
  rus: 'Лорд Узурпатор',
  ita: 'Lord Usurpatore',
  chs: '篡位领主',
  cht: '篡位領主',
};

const ATTACK_NOTICE = { title: ATTACK_TITLE_STRING_ID };
const LANDING_NOTICE = { title: LANDING_TITLE_STRING_ID };
const REINFORCEMENTS_NOTICE = {
  title: REINFORCEMENTS_TITLE_STRING_ID,
  detail: REINFORCEMENTS_DETAIL_STRING_ID,
};
const strongerNotice = (detail: number) => ({ title: STRONGER_TITLE_STRING_ID, detail });

/** The words of the siege's notices, by string id. */
const NOTICE_STRINGS = {
  [ATTACK_TITLE_STRING_ID]: {
    pol: 'Siepacze Twierdzy ruszają do ataku!',
    eng: 'The Fortress enforcers march to attack!',
    ger: 'Die Schlächter der Festung ziehen zum Angriff!',
    rus: 'Приспешники Крепости идут в атаку!',
    ita: "Gli sgherri della Fortezza marciano all'attacco!",
    chs: '要塞的爪牙发起了进攻！',
    cht: '要塞的爪牙發起了進攻！',
  },
  [LANDING_TITLE_STRING_ID]: {
    pol: 'Okręty Krainy Ciemności przybijają do brzegu!',
    eng: 'Darkland ships are landing on the shore!',
    ger: 'Schiffe der Dunkelländer legen am Ufer an!',
    rus: 'Корабли Страны Тьмы причаливают к берегу!',
    ita: 'Le navi delle Terre Oscure approdano sulla riva!',
    chs: '暗地人的战船正在靠岸！',
    cht: '暗地人的戰船正在靠岸！',
  },
  [REINFORCEMENTS_TITLE_STRING_ID]: {
    pol: 'Lord Uzurpator wezwał wsparcie!',
    eng: 'Lord Usurper has called for reinforcements!',
    ger: 'Lord Usurpator hat Verstärkung gerufen!',
    rus: 'Лорд Узурпатор призвал подкрепление!',
    ita: 'Lord Usurpatore ha chiamato rinforzi!',
    chs: '篡位领主召来了援军！',
    cht: '篡位領主召來了援軍！',
  },
  [REINFORCEMENTS_DETAIL_STRING_ID]: {
    pol: 'Płynie ogromna flota desantowa.',
    eng: 'A huge landing fleet is on its way.',
    ger: 'Eine riesige Landungsflotte ist unterwegs.',
    rus: 'Огромный десантный флот уже в пути.',
    ita: "Un'enorme flotta da sbarco è in arrivo.",
    chs: '一支庞大的登陆舰队正在驶来。',
    cht: '一支龐大的登陸艦隊正在駛來。',
  },
  [STRONGER_TITLE_STRING_ID]: {
    pol: 'Wojownicy Twierdzy rosną w siłę.',
    eng: 'The Fortress warriors grow stronger.',
    ger: 'Die Krieger der Festung werden stärker.',
    rus: 'Воины Крепости становятся сильнее.',
    ita: 'I guerrieri della Fortezza diventano più forti.',
    chs: '要塞的战士变得更强了。',
    cht: '要塞的戰士變得更強了。',
  },
  [LIGHT_ARMOR_DETAIL_STRING_ID]: {
    pol: 'Otrzymali lepszą broń i lekkie zbroje.',
    eng: 'They received better weapons and light armour.',
    ger: 'Sie haben bessere Waffen und leichte Rüstungen erhalten.',
    rus: 'Они получили лучшее оружие и лёгкие доспехи.',
    ita: 'Hanno ricevuto armi migliori e armature leggere.',
    chs: '他们获得了更好的武器和轻甲。',
    cht: '他們獲得了更好的武器和輕甲。',
  },
  [HEAVY_ARMOR_DETAIL_STRING_ID]: {
    pol: 'Otrzymali ciężkie zbroje.',
    eng: 'They received heavy armour.',
    ger: 'Sie haben schwere Rüstungen erhalten.',
    rus: 'Они получили тяжёлые доспехи.',
    ita: 'Hanno ricevuto armature pesanti.',
    chs: '他们获得了重甲。',
    cht: '他們獲得了重甲。',
  },
  [AMULETS_DETAIL_STRING_ID]: {
    pol: 'Otrzymali amulety.',
    eng: 'They received amulets.',
    ger: 'Sie haben Amulette erhalten.',
    rus: 'Они получили амулеты.',
    ita: 'Hanno ricevuto amuleti.',
    chs: '他们获得了护身符。',
    cht: '他們獲得了護身符。',
  },
  [HEAL_DRAUGHTS_DETAIL_STRING_ID]: {
    pol: 'Otrzymali mikstury leczenia.',
    eng: 'They received healing potions.',
    ger: 'Sie haben Heiltränke erhalten.',
    rus: 'Они получили зелья лечения.',
    ita: 'Hanno ricevuto pozioni di guarigione.',
    chs: '他们获得了治疗药水。',
    cht: '他們獲得了治療藥水。',
  },
};

/** A small ship's crew: its nineteen passenger seats and the commander's. */
const SHIP_MEN = 20;
/** How far around a landing ship the players see it, the whole voyage, in map points. */
const SHIP_REVEAL_NODES = 12;

const MINUTE = 60;
const QUARTER_HOUR = 15 * MINUTE;
const HALF_HOUR = 30 * MINUTE;
const HOUR = 60 * MINUTE;
/** The house mission object id the plain's headquarters is placed with, which its trade rows name. */
const PLAIN_HEADQUARTERS = 1;
/** Owner ruling: choosing the variant sets the iron and gold deposits to three times their stock. */
const ORE_YIELD = 3;

/** Owner ruling: every player seat starts as seat 0 does, with its people, papers and diplomacy locks.
 *  The map hands the villages a few civilians and seats 1-3 a girl where seat 0 has a second boy. */
const START_SEAT = 0;
const START_HEADQUARTERS = { x: 428, y: 264 };
/** The point each other seat's people stand around as seat 0's stand around its headquarters: the seat's
 *  own headquarters, one row up for seats 2-4, where a tree or stone would stand under one of them. */
const START_POINTS = [
  { seat: 1, x: 125, y: 194 },
  { seat: 2, x: 352, y: 155 },
  { seat: 3, x: 133, y: 389 },
  { seat: PLAIN_SEAT, x: 250, y: 111 },
  { seat: HIGHLAND_SEAT, x: 315, y: 378 },
];
const START_SEATS = START_POINTS.map((point) => ({
  player: point.seat,
  from: START_SEAT,
  dx: point.x - START_HEADQUARTERS.x,
  dy: point.y - START_HEADQUARTERS.y,
}));
/** The seat the map leaves without the fortress in view at the start, which the others see (`ExploreArea`). */
const UNREVEALED_SEAT = 3;

/** The plain's headquarters (250, 112) has five clay nodes and a few trees in reach, where every other
 *  seat has dozens: a clay pit beside those five on the brown shore south of the lake, packed node to
 *  node like the map's own pits and following the shoreline, off the fire circle (254-258, 103-107); a
 *  cedar grove north-west by the lake, 15-23 map points out; and more cedars east of the map's own
 *  stand on the meadow north of the lake. */
const PLAIN_CLAY_PIT = [
  [264, 104],
  [265, 104],
  [262, 105],
  [263, 105],
  [264, 105],
  [265, 105],
  [266, 105],
  [262, 106],
  [263, 106],
  [264, 106],
  [265, 106],
  [266, 106],
  [267, 106],
  [263, 107],
  [264, 107],
  [265, 107],
  [266, 107],
  [263, 108],
  [264, 108],
  [265, 108],
] as const;
const PLAIN_GROVE = [
  [240, 89],
  [243, 89],
  [246, 89],
  [239, 91],
  [242, 91],
  [245, 91],
  [248, 91],
  [240, 93],
  [243, 93],
  [246, 93],
  [239, 95],
  [242, 95],
  [245, 95],
  [248, 95],
  [240, 97],
  [243, 97],
  [246, 97],
  [241, 99],
  [244, 99],
  [247, 99],
] as const;
const NORTH_CEDARS = [
  [276, 62],
  [279, 60],
  [282, 63],
  [285, 61],
  [275, 65],
  [278, 66],
  [281, 67],
  [284, 65],
  [287, 64],
  [272, 70],
  [276, 69],
  [279, 72],
  [282, 71],
  [274, 72],
] as const;
/** The map's own looks for clay and cedars, alternated. */
const CLAY_OBJECTS = ['clay mine 01', 'clay mine 02'];
const CEDAR_OBJECTS = ['cedar 01', 'cedar 02'];
const placed = (points: readonly (readonly [number, number])[], objects: readonly string[]) =>
  points.map(([hx, hy], i) => ({ object: objects[i % objects.length] ?? '', hx, hy }));

/** The authored map's seat 0-3 lobby offer, which Ragnarök extends to the two villages. */
const PLAYER_SEAT_OFFER = ['human', 'ai', 'none'] as const;

/** The raider camps' recurring flag waves, which Ragnarök replaces with its own attack schedule. */
const RAIDER_WAVE_MISSIONS = RAIDER_SEATS.flatMap((seat) => [
  `Generate 20 min P${seat}`,
  `Restart Timer P${seat}`,
]);

const result = (...values: string[]) => ({ key: 'result', values });
const reveal = (seat: number, x: number, y: number, radius: number) =>
  result('ExploreArea', String(seat), String(x), String(y), String(radius));
/** Each new player seat sees an ally's start area the way the authored seats 0-3 do. */
const revealToNewSeats = (x: number, y: number, radius: number) => [
  reveal(PLAIN_SEAT, x, y, radius),
  reveal(HIGHLAND_SEAT, x, y, radius),
];

/**
 * Ragnarök on Forteca: the plain's villagers (seat 4) and the highlanders (seat 5) play as ordinary
 * seats instead of waiting to be taken over, so their take-over missions, seat 4's trade post and the
 * authored raider waves go. Coordinates are the map's own `ExploreArea` areas.
 */
export const SPECJALNA_FORTECA_RAGNAROK: MapVariantInput = {
  mapId: 'specjalna_forteca',
  kind: 'ragnarok',
  script: {
    slotOptions: [
      { player: PLAIN_SEAT, allowed: [...PLAYER_SEAT_OFFER] },
      { player: HIGHLAND_SEAT, allowed: [...PLAYER_SEAT_OFFER] },
    ],
    neutralizedMissions: [
      'Changezu_P4',
      'Changezu_P5',
      'Start Attack 60 min',
      ...RAIDER_WAVE_MISSIONS,
      // The fortress's 65-second refill pulse: the siege's guard refill takes it over.
      'Defend Timer',
      'Defend Timer Restart',
    ],
    appendedResults: [
      {
        mission: 'MissionWon',
        results: [result('MissionWon', String(PLAIN_SEAT)), result('MissionWon', String(HIGHLAND_SEAT))],
      },
      {
        mission: 'Alle AI´s sichtbar',
        results: [
          ...revealToNewSeats(245, 246, 40),
          reveal(UNREVEALED_SEAT, 245, 246, 40),
          reveal(PLAIN_SEAT, 308, 377, 25),
          reveal(HIGHLAND_SEAT, 250, 112, 25),
        ],
      },
      { mission: 'Explore 0', results: revealToNewSeats(428, 265, 25) },
      { mission: 'Explore 1', results: revealToNewSeats(125, 193, 25) },
      { mission: 'Explore 2', results: revealToNewSeats(352, 155, 25) },
      { mission: 'Explore 3', results: revealToNewSeats(133, 389, 25) },
    ],
    droppedTradeHouses: [PLAIN_HEADQUARTERS],
    appendedAiTasks: [
      {
        player: FORTRESS_SEAT,
        tasks: INNER_POSTS.map((post) => ({
          kind: 'defend' as const,
          priority: INNER_POST_PRIORITY,
          condition: ALWAYS,
          ...post,
          range: INNER_POST_RANGE,
          min: 0,
          max: 0,
        })),
      },
    ],
  },
  startSeats: START_SEATS,
  oreYield: ORE_YIELD,
  landscapeObjects: [
    ...placed(PLAIN_CLAY_PIT, CLAY_OBJECTS),
    ...placed(PLAIN_GROVE, CEDAR_OBJECTS),
    ...placed(NORTH_CEDARS, CEDAR_OBJECTS),
  ],
  briefingPages: SPECJALNA_FORTECA_RAGNAROK_BRIEFING,
  strings: { [LORD_NAME_STRING_ID]: LORD_NAME, ...NOTICE_STRINGS },
  // The owner's numbers.
  modules: {
    siege: {
      version: 1,
      stronghold: { seat: FORTRESS_SEAT, ...KEEP },
      tribe: FORTRESS_TRIBE,
      jobMix: [
        { job: SWORD_LONG, weight: 2 },
        { job: SWORD_SHORT, weight: 1 },
        { job: BOW_LONG, weight: 2 },
        { job: SPEAR_IRON, weight: 1 },
        { job: SPEAR_WOODEN, weight: 1 },
      ],
      attacks: {
        launches: [
          { atSeconds: 30 * MINUTE, landMen: 10, ships: 0 },
          { atSeconds: 45 * MINUTE, landMen: 15, ships: 0 },
          { atSeconds: 65 * MINUTE, landMen: 25, ships: 0 },
          { atSeconds: 90 * MINUTE, landMen: 35, ships: 1 },
          { atSeconds: 110 * MINUTE, landMen: 45, ships: 2 },
          { atSeconds: 130 * MINUTE, landMen: 120, ships: 0 },
          // Lord Usurper's great fleet: a ship at every landing.
          { atSeconds: 150 * MINUTE, landMen: 20, ships: 5, notice: REINFORCEMENTS_NOTICE },
        ],
        repeat: { everySeconds: 20 * MINUTE, waves: [{ landMen: 60, ships: 3 }] },
        endDeadPct: 80,
        endAfterSeconds: 10 * MINUTE,
        targets: RAIDS,
        notice: ATTACK_NOTICE,
      },
      guard: {
        base: 140,
        perSeatStep: 5,
        stepSeconds: HALF_HOUR,
        perSeatMax: 30,
        // Two men a pulse at the start, one more for every quarter hour played.
        refill: { everySeconds: 40, baseMen: 2, stepMen: 1, stepSeconds: QUARTER_HOUR, maxMen: 16 },
      },
      towerGarrison: {
        slots: [
          { job: BOW_SHORT, count: TOWER_ARCHERS_PER_BOW },
          { job: BOW_LONG, count: TOWER_ARCHERS_PER_BOW },
        ],
      },
      landings: {
        vehicle: 'ship_small',
        menPerShip: SHIP_MEN,
        notice: LANDING_NOTICE,
        revealNodes: SHIP_REVEAL_NODES,
      },
      catapults: { respawnSeconds: CATAPULT_RESPAWN_MINUTES * MINUTE },
      builders: { count: FORTRESS_BUILDERS },
      porters: { count: FORTRESS_PORTERS, vehicle: 'handcart', x: KEEP.x, y: KEEP.y, radius: PORTER_RADIUS },
    },
    gearSchedule: {
      version: 1,
      seats: [FORTRESS_SEAT, ...RAIDER_SEATS],
      steps: [
        {
          atSeconds: HOUR,
          notice: strongerNotice(LIGHT_ARMOR_DETAIL_STRING_ID),
          grants: [{ goods: LIGHT_ARMOR }, { goods: ['shoes'] }],
          weaponUpgrades: BETTER_WEAPONS,
        },
        {
          atSeconds: 105 * MINUTE,
          notice: strongerNotice(HEAVY_ARMOR_DETAIL_STRING_ID),
          grants: [{ goods: HEAVY_ARMOR }],
        },
        {
          atSeconds: 135 * MINUTE,
          notice: strongerNotice(AMULETS_DETAIL_STRING_ID),
          grants: [{ goods: COMBAT_AMULETS, extraChancePct: SECOND_AMULET_CHANCE_PCT }],
        },
        {
          atSeconds: 150 * MINUTE,
          notice: strongerNotice(HEAL_DRAUGHTS_DETAIL_STRING_ID),
          grants: [{ goods: ['potion_heal_big'], chancePct: HEAL_DRAUGHT_CHANCE_PCT }],
        },
      ],
    },
    heroes: {
      version: 1,
      placed: [
        {
          seat: FORTRESS_SEAT,
          job: SWORD_LONG,
          tribe: FORTRESS_TRIBE,
          x: KEEP.x,
          y: KEEP.y,
          hitpoints: LORD_HITPOINTS,
          equipment: LORD_EQUIPMENT,
          nameStringId: LORD_NAME_STRING_ID,
          hero: true,
          scalePct: LORD_SCALE_PCT,
        },
      ],
    },
    // Owner ruling: nothing falls from the fortress side's men.
    deathDrops: { version: 1, withheldSeats: [FORTRESS_SEAT, ...RAIDER_SEATS] },
    // Owner ruling: a computer seat starts building up with every man it has.
    demobilizedStart: { version: 1 },
  },
};
