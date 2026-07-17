/**
 * The committed catalog of `jobtypes.ini` job ids — the original's `[jobtype]` record numbers, transcribed
 * verbatim. These are the semantic job ids the sim stamps on a settler, the profession roster offers, the
 * building worker slots staff, and the render/name reducers key bodies off, so they live in `catalog/`
 * where the game content (`game/sandbox/`), the binding reducers (`content/settler-gfx/`) and the
 * profession roster can all read them without either owning the other's vocabulary — the same charter as
 * `catalog/atomics.ts`. The sandbox's own derived ids (the rebased worker-slot band) live with the rebase,
 * in `game/sandbox/ids/economy/jobs.ts`.
 */

/** No trade — the settler stands idle until assigned one. */
export const JOB_IDLE = 0;

// The age/sex life-stage classes + the two generic adults (`jobtypes.ini`/`logicdefines.inc` 1..6).
// The family mechanics' vocabulary: sex is stamped from these slugs at spawn (`baby_female`/
// `child_female`/`woman` → the sim's Female marker), a girl matures into `woman`, and the kiss/
// make_love animation durations resolve through the woman/civilist bindings.
export const JOB_BABY_FEMALE = 1;
export const JOB_BABY_MALE = 2;
export const JOB_CHILD_FEMALE = 3;
export const JOB_CHILD_MALE = 4;
export const JOB_WOMAN = 5;
export const JOB_CIVILIST = 6;

// The builder trade — the real viking `jobtypes.ini` id 7. The planner puts this job on foundations.
export const JOB_BUILDER = 7;
// The collector — the original's single outdoor gatherer trade (`jobtypes.ini` type 8). One collector
// fells wood, mines every deposit, and picks mushrooms (its real `allowedAtomics` cover all six harvest
// atomics), so the sandbox's per-good {@link import('../game/sandbox/ids/economy/gatherers.js').GATHERERS}
// rows all bind this one job rather than a per-good gatherer trade. Real ir.json numbers it the same, so a
// placed collector resolves against either the sandbox or the real content base.
export const JOB_COLLECTOR = 8;

/**
 * The production trades, at their real `jobtypes.ini` ids. Baker/brewer/fisher/trader (20..22, 25) sit at
 * their real ids too — the synthetic gatherer band that used to shadow them is gone.
 */
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

// The carrier/porter — the real `jobtypes.ini` type 24. Ferries goods between stores; the sim's
// job-agnostic haul fallback. Not in `ADULT_CHARACTER_BY_JOB`, so it draws the civilian body.
export const JOB_CARRIER = 24;
export const JOB_TRADER = 25;
/** The scout (`jobtypes.ini` type 27) — erects signposts (its one allowed atomic, build-guide 43). */
export const JOB_SCOUT = 27;
export const JOB_JESTER = 28;
export const JOB_HERBALIST = 29; // jobtypes.ini "herb & mush guy"
export const JOB_DRUID = 30;

// Soldier jobs ride the real viking `jobtypes.ini` ids (soldiers 31..41) so the render's job→body map
// (`ADULT_CHARACTER_BY_JOB`) draws each class's own warrior body + weapon animation set.
export const JOB_SOLDIER_UNARMED = 31; // soldier_unarmed — the fists warrior (empty-hand body, brawls)
// The base, unarmed soldier (`jobtypes.ini` type 31) is also the single profession the picker offers; a
// weapon (a later step) specializes it into a spear/sword/bow class. Same job as {@link JOB_SOLDIER_UNARMED},
// named for the picker.
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
// The named heroes (`jobtypes.ini` types 42..47) — mission-map elites the decoded `sethuman` records
// place. Their own bodies exist in `jobgraphics.ini` but aren't extracted yet, so the render borrows
// the warrior body of each hero's `baseatomics` soldier class (docs/tickets/render/hero-character-bodies.md).
export const JOB_HERO_UNARMED = 42; // hero_unarmed
export const JOB_HERO_SPEAR = 43; // hero_spear_siegfried
export const JOB_HERO_SWORD = 44; // hero_sword_bjarni
export const JOB_HERO_SABER = 45; // hero_saber_hatschi
export const JOB_HERO_AXE = 46; // hero_axe
export const JOB_HEROINE_BOW = 47; // heroine_bow_xena

/** The `jobtypes.ini` soldier band (unarmed base + weapon classes) — every one reads as "Żołnierz". */
export const SOLDIER_JOB_MIN = JOB_SOLDIER_UNARMED;
export const SOLDIER_JOB_MAX = JOB_ARCHER_LONG;
