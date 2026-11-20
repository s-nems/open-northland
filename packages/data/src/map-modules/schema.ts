import { z } from 'zod';

// The bounds below are ours: they cap what one beat of a map from anywhere may ask of the simulation.
// They do not cap how many men a long match gathers; attackers that outlive their attack stay.

/** The most men one spawn makes at once, as a mission's `CreateCreatures` caps its own. */
const MAX_SPAWN_MEN = 500;
/** The most soldiers a guard cap may ask for. */
const MAX_GUARD_MEN = 2000;
/** The most workers or tower men of one kind a module keeps up. */
const MAX_CREW = 50;
/** The player seats a map has. */
const MAX_SEATS = 16;
/** The largest half-cell coordinate a map point may name; the fit check holds it to the map's own size. */
const MAX_MAP_POINT = 4096;
const MAX_HITPOINTS = 1_000_000;
/** The longest time a schedule may name: a hundred hours of play. */
const MAX_SECONDS = 360_000;
/** The shortest beat a repeating pulse may have, so a pulse never runs every few ticks. */
const MIN_PULSE_SECONDS = 10;
/** The shortest time between two repeated attacks. */
const MIN_REPEAT_SECONDS = 60;
/** The most men one attack sends on foot, over all its targets. */
const MAX_LAUNCH_MEN = 1000;
/** The widest view around a landing ship, in half-cell nodes. */
const MAX_REVEAL_NODES = 50;
const MAX_LAUNCHES = 200;
const MAX_GEAR_STEPS = 50;
const MAX_LIST = 50;

const seconds = z.number().int().min(0).max(MAX_SECONDS);
const interval = z.number().int().min(1).max(MAX_SECONDS);
const pulse = z.number().int().min(MIN_PULSE_SECONDS).max(MAX_SECONDS);
const seat = z
  .number()
  .int()
  .min(0)
  .max(MAX_SEATS - 1);
/** A half-cell node of the map, as the map's own AI rows name points. */
const mapPoint = z.number().int().min(0).max(MAX_MAP_POINT);
const men = z.number().int().min(0).max(MAX_SPAWN_MEN);
const crew = z.number().int().min(0).max(MAX_CREW);
const pct = z.number().int().min(0).max(100);
/** A content slug: a job, tribe, building, good or vehicle by its name in the game's data. */
const slug = z.string().min(1).max(64);
/** An id in the map's own string table. */
const stringId = z.number().int().nonnegative();
/** The contract revision of one module; a game reads exactly the revision it was built for. */
const revision = <N extends number>(n: N) => z.literal(n);

/** A centre-screen notice told in the map's own words: a title and an optional second line. */
export const MapNotice = z.strictObject({ title: stringId, detail: stringId.optional() });
export type MapNotice = z.infer<typeof MapNotice>;

/** One trade of a spawn mix and its share; the mix splits a spawn by weight, larger remainders first. */
export const MapJobShare = z.strictObject({ job: slug, weight: z.number().int().min(1).max(100) });
export type MapJobShare = z.infer<typeof MapJobShare>;

/** The most ships one attack sends against a seat, each from its own landing points. */
export const MAP_SIEGE_MAX_SHIPS = 5;

/** What one attack sends against each targeted seat: men on foot from the stronghold, and ships, each
 *  sailing from the next of the seat's landing points. */
export const MapSiegeWaveSize = z.strictObject({
  landMen: men,
  ships: z.number().int().min(0).max(MAP_SIEGE_MAX_SHIPS),
});
export type MapSiegeWaveSize = z.infer<typeof MapSiegeWaveSize>;

/** Where a seat's sea landing comes from and where it puts its men ashore: a sea node the ship
 *  appears on, and the shore node it docks at and lands them on. */
const MapSiegeLandingPoints = z.strictObject({
  spawnX: mapPoint,
  spawnY: mapPoint,
  x: mapPoint,
  y: mapPoint,
});

/** A targeted player seat, the raider seat that attacks it and the point its men march on: the
 *  seat's headquarters, which the attack holds to while it stands. A wave's ships take its landings in
 *  order, so the first ones are the seat's usual coast and the later ones spread the attack. */
const MapSiegeTarget = z.strictObject({
  seat,
  raider: seat,
  x: mapPoint,
  y: mapPoint,
  landings: z.array(MapSiegeLandingPoints).max(MAP_SIEGE_MAX_SHIPS).default([]),
});
export type MapSiegeTarget = z.infer<typeof MapSiegeTarget>;

/** The guard's refill pulse: every `everySeconds` (the first one interval in) `baseMen` plus `stepMen`
 *  for each completed `stepSeconds` of game time, at most `maxMen`. */
const MapSiegeRefill = z.strictObject({
  everySeconds: pulse,
  baseMen: men,
  stepMen: men,
  stepSeconds: interval,
  maxMen: men,
});

/** One trade a tower is manned with and how many of it, at most the tower's own posts for it. */
const MapSiegeTowerSlot = z.strictObject({ job: slug, count: crew.min(1) });

const ascending = (values: readonly number[]) => values.every((v, i) => i === 0 || (values[i - 1] ?? v) < v);

/**
 * A siege: a stronghold seat that keeps its garrison growing and sends a fresh attack from its
 * stronghold against every occupied player seat on a fixed schedule. Times count from match start.
 * One stronghold, and one raider seat per targeted seat, is the shape this revision knows.
 */
export const MapSiege = z
  .strictObject({
    version: revision(1),
    /** The stronghold seat, its keep building (kind and the range of the point it stands on) and where
     *  its men spawn. Nothing spawns once no finished keep stands there. */
    stronghold: z.strictObject({
      seat,
      building: slug,
      x: mapPoint,
      y: mapPoint,
      range: z.number().int().min(0).max(MAX_MAP_POINT),
    }),
    /** The tribe the spawned men belong to. */
    tribe: slug,
    jobMix: z.array(MapJobShare).min(1).max(MAX_LIST),
    attacks: z.strictObject({
      /** The scheduled launches, ascending; a launch's `notice` replaces the attack notice for it. */
      launches: z
        .array(MapSiegeWaveSize.extend({ atSeconds: seconds, notice: MapNotice.optional() }))
        .min(1)
        .max(MAX_LAUNCHES),
      /** After the last launch, one more every `everySeconds`, cycling through `waves`. */
      repeat: z.strictObject({
        everySeconds: z.number().int().min(MIN_REPEAT_SECONDS).max(MAX_SECONDS),
        waves: z.array(MapSiegeWaveSize).min(1).max(MAX_LIST),
      }),
      /** An attack ends once this share of the men it sent (land and sea) is dead, or `endAfterSeconds`
       *  after its launch, whichever comes first. Survivors fight on, outside the attack. */
      endDeadPct: pct.min(1),
      endAfterSeconds: interval,
      targets: z.array(MapSiegeTarget).min(1).max(MAX_SEATS),
      /** The notice shown when an attack sets out; absent, none. */
      notice: MapNotice.optional(),
    }),
    /** The stronghold's own guard: a soldier cap of `base` plus, per occupied target seat,
     *  `perSeatStep` for each completed `stepSeconds`, at most `perSeatMax`; filled by the refill beats. */
    guard: z.strictObject({
      base: z.number().int().min(0).max(MAX_GUARD_MEN),
      perSeatStep: men,
      stepSeconds: interval,
      perSeatMax: men,
      refill: MapSiegeRefill,
    }),
    /** The sea landings a wave with ships brings: each ship of `vehicle` carries `menPerShip`, at most
     *  its seats, commander's included. `notice` is shown when the ships set out. Every targeted seat not
     *  counted out sees `revealNodes` around each ship under way, 0 for none. */
    landings: z
      .strictObject({
        vehicle: slug,
        menPerShip: men,
        notice: MapNotice.optional(),
        revealNodes: z.number().int().min(0).max(MAX_REVEAL_NODES).default(0),
      })
      .optional(),
    /** The stronghold seat's catapults standing at the first turn come back at their spot this long
     *  after one is lost, one per guard refill beat, while the keep stands. */
    catapults: z.strictObject({ respawnSeconds: interval }).optional(),
    /** The stronghold seat's builders kept at `count`, the missing ones made at the keep on each guard
     *  refill beat while the stronghold holds; the seat's map-AI town pass sends them to its sites. */
    builders: z.strictObject({ count: crew }).optional(),
    /** The stronghold seat's porters: up to `count` carriers posted at its storehouse nearest the keep,
     *  each pulling a `vehicle` hauling cart and holding a flag at (`x`, `y`) whose area reaches `radius`
     *  half-cell nodes (Manhattan, as any flag's work area), so they carry the goods lying there into the
     *  store. Made at the keep, cart and post included, on each guard refill beat while the stronghold
     *  holds; a porter whose cart is gone gets a new one. */
    porters: z
      .strictObject({
        count: crew,
        vehicle: slug,
        x: mapPoint,
        y: mapPoint,
        radius: z.number().int().min(0).max(MAX_MAP_POINT),
      })
      .optional(),
    /** The stronghold seat's towers, each of its finished buildings with a post for a slot's trade,
     *  manned with `slots`, each capped at the building's posts for it. The missing men are made at the
     *  keep and posted on each guard refill beat while the stronghold holds, so a lost man is replaced
     *  and a tower raised again is manned again. The seat's map-AI posting keeps them on the wall, gear
     *  steps leave their weapons, and they stand outside the guard's count. */
    towerGarrison: z.strictObject({ slots: z.array(MapSiegeTowerSlot).min(1).max(MAX_LIST) }).optional(),
  })
  .superRefine((value, ctx) => {
    if (!ascending(value.attacks.launches.map((row) => row.atSeconds)))
      ctx.addIssue({ code: 'custom', path: ['attacks', 'launches'], message: 'launches must ascend' });
    const refill = value.guard.refill;
    if (refill.baseMen > refill.maxMen)
      ctx.addIssue({ code: 'custom', path: ['guard', 'refill'], message: 'refill starts above its max' });
    const targets = value.attacks.targets;
    const seats = new Set(targets.map((row) => row.seat));
    if (seats.size !== targets.length)
      ctx.addIssue({ code: 'custom', path: ['attacks', 'targets'], message: 'a seat is targeted twice' });
    const raiders = targets.map((row) => row.raider);
    if (new Set(raiders).size !== raiders.length)
      ctx.addIssue({ code: 'custom', path: ['attacks', 'targets'], message: 'a raider seat attacks twice' });
    if (raiders.includes(value.stronghold.seat))
      ctx.addIssue({ code: 'custom', path: ['attacks', 'targets'], message: 'the stronghold is a raider' });
    if (raiders.some((raider) => seats.has(raider)))
      ctx.addIssue({ code: 'custom', path: ['attacks', 'targets'], message: 'a raider seat is a target' });
    const waves = [...value.attacks.launches, ...value.attacks.repeat.waves];
    if (waves.some((wave) => wave.landMen * targets.length > MAX_LAUNCH_MEN))
      ctx.addIssue({
        code: 'custom',
        path: ['attacks'],
        message: `an attack sends more than ${MAX_LAUNCH_MEN} men on foot`,
      });
  });
export type MapSiege = z.infer<typeof MapSiege>;

/** One piece of a gear step: each soldier draws `chancePct` for it, then one of `goods` at random, and
 *  then `extraChancePct` for one more, a different one of `goods`; the good's own equip category names
 *  the slot, a misc good the first free one. */
const MapGearGrant = z.strictObject({
  goods: z.array(slug).min(1).max(MAX_LIST),
  chancePct: pct.min(1).default(100),
  extraChancePct: pct.default(0),
});

/** A soldier whose weapon is the good `from` takes up `to` instead, and with it the trade that weapon
 *  arms, as a soldier equipping it at a store does. */
const MapWeaponUpgrade = z.strictObject({ from: slug, to: slug });

/** At `atSeconds` every soldier of the schedule's seats gets the step's grants and weapon upgrades,
 *  and so does every soldier they create later. */
const MapGearStep = z
  .strictObject({
    atSeconds: seconds,
    notice: MapNotice.optional(),
    grants: z.array(MapGearGrant).max(MAX_LIST).default([]),
    weaponUpgrades: z.array(MapWeaponUpgrade).max(MAX_LIST).default([]),
  })
  .refine((step) => step.grants.length + step.weaponUpgrades.length > 0, 'a gear step gives nothing');

/** Gear handed out over time: the seats whose soldiers get it, and the steps, ascending. A placed hero
 *  keeps what he was placed with. */
export const MapGearSchedule = z
  .strictObject({
    version: revision(1),
    seats: z.array(seat).min(1).max(MAX_SEATS),
    steps: z.array(MapGearStep).min(1).max(MAX_GEAR_STEPS),
  })
  .refine((value) => ascending(value.steps.map((row) => row.atSeconds)), 'gear steps must ascend');
export type MapGearSchedule = z.infer<typeof MapGearSchedule>;

/** The drawn sizes a hero may take, in percent: past them his art would crowd or vanish among the others. */
const HERO_SCALE_MIN_PCT = 50;
const HERO_SCALE_MAX_PCT = 200;

/** A defender placed at match start: a soldier of `job` and `tribe` for `seat` at the node nearest
 *  (`x`, `y`) free of buildings, with `hitpoints` and `equipment` (each good's equip category names its
 *  slot). He holds his ground there, outside every scripted task. `nameStringId` names him from the
 *  map's string table. */
export const MapHero = z.strictObject({
  seat,
  job: slug,
  tribe: slug,
  x: mapPoint,
  y: mapPoint,
  hitpoints: z.number().int().min(1).max(MAX_HITPOINTS),
  equipment: z.array(slug).max(MAX_LIST).default([]),
  nameStringId: stringId.optional(),
  /** Marked the way a map marks its heroes: the owner-coloured hero glow, and needs that never fall. */
  hero: z.boolean().default(false),
  /** How large he draws, in percent of his look's size, about his feet; absent draws him at full size. */
  scalePct: z.number().int().min(HERO_SCALE_MIN_PCT).max(HERO_SCALE_MAX_PCT).optional(),
});
export type MapHero = z.infer<typeof MapHero>;

/** The defenders placed once, at match start. None comes back. */
export const MapHeroes = z.strictObject({
  version: revision(1),
  placed: z.array(MapHero).min(1).max(MAX_LIST),
});
export type MapHeroes = z.infer<typeof MapHeroes>;

/** A fallen character of one of `withheldSeats` drops nothing: everything it wore and carried stays
 *  with its bones. */
export const MapDeathDrops = z.strictObject({
  version: revision(1),
  withheldSeats: z.array(seat).min(1).max(MAX_SEATS),
});
export type MapDeathDrops = z.infer<typeof MapDeathDrops>;

/** At match start every soldier of a seat the computer player runs becomes a civilian, so the seat
 *  builds up with them; human, idle and map-scripted seats keep theirs. */
export const MapDemobilizedStart = z.strictObject({ version: revision(1) });
export type MapDemobilizedStart = z.infer<typeof MapDemobilizedStart>;

/**
 * The rules a map adds to its script: mechanics the engine offers and the map configures. Each module
 * stands alone and carries its own revision; an absent one changes nothing.
 */
export const MapModules = z.strictObject({
  siege: MapSiege.optional(),
  gearSchedule: MapGearSchedule.optional(),
  heroes: MapHeroes.optional(),
  deathDrops: MapDeathDrops.optional(),
  demobilizedStart: MapDemobilizedStart.optional(),
});
export type MapModules = z.infer<typeof MapModules>;
export type MapModulesInput = z.input<typeof MapModules>;
