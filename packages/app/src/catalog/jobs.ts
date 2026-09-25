/**
 * The committed catalog of `jobtypes.ini` job ids, transcribed verbatim from the original's `[jobtype]`
 * record numbers: the semantic job ids the sim stamps on a settler and the render and name reducers key
 * bodies off. The sandbox's own derived ids live with the rebase, in `game/sandbox/ids/economy/jobs.ts`.
 */

/** No trade: the settler stands idle until assigned one. */
export const JOB_IDLE = 0;

// The life-stage classes and the two generic adults (`jobtypes.ini`/`logicdefines.inc` 1..6). Sex is
// stamped from these slugs at spawn, and a girl matures into `woman`.
export const JOB_BABY_FEMALE = 1;
export const JOB_BABY_MALE = 2;
export const JOB_CHILD_FEMALE = 3;
export const JOB_CHILD_MALE = 4;
export const JOB_WOMAN = 5;
export const JOB_CIVILIST = 6;

export const JOB_BUILDER = 7;
// The original's single outdoor gatherer trade: one collector's `allowedAtomics` cover all six harvest
// atomics, so the sandbox's per-good gatherer rows all bind this one job.
export const JOB_COLLECTOR = 8;

/** The production trades, at their real `jobtypes.ini` ids. */
export const JOB_JOINER = 9;
export const JOB_ARMORER = 10;
export const JOB_POTTER = 11;
export const JOB_MASON = 12;
export const JOB_SMITH = 13;
export const JOB_COIN_MAKER = 14;
export const JOB_HUNTER = 15;
export const JOB_BREEDER = 16;
export const JOB_TAILOR = 17; // jobtypes.ini "sewer"
export const JOB_FARMER = 18;
export const JOB_MILLER = 19;
export const JOB_BAKER = 20;
export const JOB_BREWER = 21;
export const JOB_FISHER = 22;

// The porter trade that ferries goods between stores; it has no own body, so it draws the civilian one.
export const JOB_CARRIER = 24;
export const JOB_TRADER = 25;
/** The scout, whose one allowed atomic is build-guide 43: erecting signposts. */
export const JOB_SCOUT = 27;
export const JOB_HERBALIST = 29; // jobtypes.ini "herb & mush guy"
export const JOB_DRUID = 30;

// Soldiers ride the real `jobtypes.ini` ids 31..41 so each class draws its own warrior body and weapon
// animation set.
export const JOB_SOLDIER_UNARMED = 31; // soldier_unarmed - the fists warrior
// The same job under the name the profession picker offers; a weapon specializes it into a class.
export const JOB_SOLDIER = JOB_SOLDIER_UNARMED;
export const JOB_SOLDIER_SPEAR_WOODEN = 32; // soldier_spear_wooden
export const JOB_SOLDIER_SPEAR = 33; // soldier_spear_iron
export const JOB_SOLDIER_SWORD = 34; // soldier_sword_short
export const JOB_SOLDIER_BROADSWORD = 35; // soldier_sword_long
export const JOB_SOLDIER_SABER_SHORT = 36; // soldier_saber_short
export const JOB_SOLDIER_SABER_LONG = 37; // soldier_saber_long
export const JOB_SOLDIER_AXE_SMALL = 38; // soldier_axe_small
export const JOB_SOLDIER_AXE_BIG = 39; // soldier_axe_big
export const JOB_ARCHER = 40; // soldier_bow_short
export const JOB_ARCHER_LONG = 41; // soldier_bow_long
// The named heroes, placed by decoded mission-map `sethuman` records.
export const JOB_HERO_UNARMED = 42; // hero_unarmed
export const JOB_HERO_SPEAR = 43; // hero_spear_siegfried
export const JOB_HERO_SWORD = 44; // hero_sword_bjarni
export const JOB_HERO_SABER = 45; // hero_saber_hatschi
export const JOB_HERO_AXE = 46; // hero_axe
export const JOB_HEROINE_BOW = 47; // heroine_bow_xena

/** The `jobtypes.ini` soldier band: the unarmed base plus every weapon class. */
export const SOLDIER_JOB_MIN = JOB_SOLDIER_UNARMED;
export const SOLDIER_JOB_MAX = JOB_ARCHER_LONG;

/** The trades `jobtypes.ini` marks `needsReligionFlag`: the only ones that go to pray unordered. */
export const RELIGION_JOBS: ReadonlySet<number> = new Set([JOB_JOINER, JOB_ARMORER, JOB_SMITH]);

/** The trades `jobtypes.ini` marks `ignoresHomeHouseFlag`: the two that travel, plus every soldier and
 *  hero. They never go home, so nothing they spend in the field is halved for being spent there. */
export const HOMELESS_JOBS: ReadonlySet<number> = new Set([
  JOB_TRADER,
  JOB_SCOUT,
  ...Array.from({ length: JOB_ARCHER_LONG - JOB_SOLDIER_UNARMED + 1 }, (_, i) => JOB_SOLDIER_UNARMED + i),
  ...Array.from({ length: JOB_HEROINE_BOW - JOB_HERO_UNARMED + 1 }, (_, i) => JOB_HERO_UNARMED + i),
]);
