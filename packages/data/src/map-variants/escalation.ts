import { z } from 'zod';
import { LANGUAGES } from '../languages.js';

const count = z.number().int().nonnegative();
const seconds = z.number().int().nonnegative();
const seat = z.number().int().nonnegative();
/** A half-cell node of the map, as the map's own AI rows name points. */
const mapPoint = z.number().int().nonnegative();

/** The notices an escalation may name, each one the app has a text for. */
export const MapEscalationNoticeKey = z.enum([
  'forteca.attack',
  'forteca.landing',
  'forteca.reinforcements',
  'forteca.gear.lightArmor',
  'forteca.gear.heavyArmor',
  'forteca.gear.amulets',
  'forteca.gear.healDraughts',
]);
export type MapEscalationNoticeKey = z.infer<typeof MapEscalationNoticeKey>;

/** One trade of a spawn mix and its share; the mix splits a spawn by weight, larger remainders first. */
export const MapEscalationJobShare = z.strictObject({
  job: z.number().int().nonnegative(),
  weight: z.number().int().positive(),
});
export type MapEscalationJobShare = z.infer<typeof MapEscalationJobShare>;

/** The most ships one attack sends against a seat, each from its own landing points. */
export const MAP_ESCALATION_MAX_SHIPS = 5;

/** What one attack sends against each targeted seat: men on foot from the keep, and ships, each
 *  sailing from the next of the seat's landing points. */
export const MapEscalationWaveSize = z.strictObject({
  landMen: count,
  ships: z.number().int().min(0).max(MAP_ESCALATION_MAX_SHIPS),
});
export type MapEscalationWaveSize = z.infer<typeof MapEscalationWaveSize>;

/** Where a seat's sea landing comes from and where it puts its men ashore: a sea node the ship
 *  appears on, and the shore node it docks at and lands them on. */
const MapEscalationLandingPoints = z.strictObject({
  spawnX: mapPoint,
  spawnY: mapPoint,
  x: mapPoint,
  y: mapPoint,
});

/** A targeted player seat, the raider seat that attacks it and the point its men march on: the
 *  seat's headquarters, which the attack holds to while it stands. A wave's ships take its landings in
 *  order, so the first ones are the seat's usual coast and the later ones spread the attack. */
const MapEscalationTarget = z.strictObject({
  seat,
  raider: seat,
  x: mapPoint,
  y: mapPoint,
  landings: z.array(MapEscalationLandingPoints).max(MAP_ESCALATION_MAX_SHIPS).default([]),
});

/** The guard's refill pulse: every `everySeconds` (the first one interval in) `baseMen` plus `stepMen`
 *  for each completed `stepSeconds` of game time, at most `maxMen`. */
const MapEscalationRefill = z.strictObject({
  everySeconds: z.number().int().positive(),
  baseMen: count,
  stepMen: count,
  stepSeconds: z.number().int().positive(),
  maxMen: count,
});

/** One piece of a gear step: each soldier draws `chancePct` for it, then one of `goods` (content good
 *  slugs) at random, and then `extraChancePct` for one more, a different one of `goods`; the good's own
 *  equip category names the slot, a misc good the first free one. */
const MapEscalationGearGrant = z.strictObject({
  goods: z.array(z.string().min(1)).min(1),
  chancePct: z.number().int().min(1).max(100).default(100),
  extraChancePct: z.number().int().min(0).max(100).default(0),
});

/** A soldier whose weapon is the good `from` takes up `to` instead (content good slugs), and with it the
 *  trade that weapon arms, as a soldier equipping it at a store does. */
const MapEscalationWeaponUpgrade = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
});

/** At `atSeconds` every soldier of the gear seats gets the step's grants and weapon upgrades, and so
 *  does every soldier they create later; `noticeKey` names the notice the app shows. */
const MapEscalationGearStep = z
  .strictObject({
    atSeconds: seconds,
    noticeKey: MapEscalationNoticeKey,
    grants: z.array(MapEscalationGearGrant).default([]),
    weaponUpgrades: z.array(MapEscalationWeaponUpgrade).default([]),
  })
  .refine((step) => step.grants.length + step.weaponUpgrades.length > 0, 'a gear step gives nothing');

/** One trade a fortress tower is manned with and how many of it, at most the tower's own posts for it. */
const MapEscalationTowerSlot = z.strictObject({
  job: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});

/** The drawn sizes a hero may take, in percent: past them his art would crowd or vanish among the others. */
const HERO_SCALE_MIN_PCT = 50;
const HERO_SCALE_MAX_PCT = 200;

/** A defender placed at match start: a soldier of `job` for `seat` at the node nearest (`x`, `y`) free of
 *  buildings, with `hitpoints` and `equipment` (content good slugs; each good's equip category names its
 *  slot). He holds his ground there, outside every scripted task, and gets no gear step. `nameStringId`
 *  is the map string id his `name` (per map text language) is added to the map's table under. */
const MapEscalationHero = z.strictObject({
  seat,
  job: z.number().int().nonnegative(),
  x: mapPoint,
  y: mapPoint,
  hitpoints: z.number().int().positive(),
  equipment: z.array(z.string().min(1)).default([]),
  nameStringId: z.number().int().nonnegative(),
  name: z.partialRecord(z.enum(LANGUAGES), z.string().min(1)),
  /** Marked the way a map marks its heroes: the owner-coloured hero glow, and needs that never fall. */
  hero: z.boolean().default(false),
  /** How large he draws, in percent of his look's size, about his feet; absent draws him at full size. */
  scalePct: z.number().int().min(HERO_SCALE_MIN_PCT).max(HERO_SCALE_MAX_PCT).optional(),
});
export type MapEscalationHero = z.infer<typeof MapEscalationHero>;

const ascending = (values: readonly number[]) => values.every((v, i) => i === 0 || (values[i - 1] ?? v) < v);

/**
 * A map's escalating siege: a fortress seat that keeps its garrison growing and sends a fresh attack
 * from its keep against every occupied player seat on a fixed schedule. Times count from match start.
 */
export const MapEscalation = z
  .strictObject({
    /** The fortress seat, its keep house (type and the range of the point it stands on) and where its
     *  men spawn. Nothing spawns once no finished keep stands there. */
    keep: z.strictObject({
      seat,
      houseType: z.number().int().positive(),
      x: mapPoint,
      y: mapPoint,
      range: count,
    }),
    /** The script's tribe number the spawned men belong to, as `CreateCreatures` names it. */
    tribe: z.number().int().nonnegative(),
    jobMix: z.array(MapEscalationJobShare).min(1),
    attacks: z.strictObject({
      /** The scheduled launches, ascending; a launch's `noticeKey` replaces the attack notice for it. */
      launches: z
        .array(
          MapEscalationWaveSize.extend({ atSeconds: seconds, noticeKey: MapEscalationNoticeKey.optional() }),
        )
        .min(1),
      /** After the last launch, one more every `everySeconds`, cycling through `waves`. */
      repeat: z.strictObject({
        everySeconds: z.number().int().positive(),
        waves: z.array(MapEscalationWaveSize).min(1),
      }),
      /** An attack ends once this share of the men it sent (land and sea) is dead, or `endAfterSeconds`
       *  after its launch, whichever comes first. Survivors fight on, outside the attack. */
      endDeadPct: z.number().int().min(1).max(100),
      endAfterSeconds: z.number().int().positive(),
      targets: z.array(MapEscalationTarget).min(1),
      /** The notice the app shows when an attack sets out; absent, it shows none. */
      noticeKey: MapEscalationNoticeKey.optional(),
    }),
    /** The fortress's own guard: a soldier cap of `base` plus, per occupied target seat,
     *  `perSeatStep` for each completed `stepSeconds`, at most `perSeatMax`; filled by the refill beats. */
    guard: z.strictObject({
      base: count,
      perSeatStep: count,
      stepSeconds: z.number().int().positive(),
      perSeatMax: count,
      refill: MapEscalationRefill,
    }),
    /** The fortress side's gear over time: the seats whose soldiers get it, and the steps, ascending. */
    gear: z
      .strictObject({
        seats: z.array(seat).min(1),
        steps: z.array(MapEscalationGearStep).min(1),
      })
      .optional(),
    /** The sea landings a wave with ships brings: each ship of `vehicle` (a content vehicle slug)
     *  carries `menPerShip`, at most its seats, commander's included. `noticeKey` names the notice the
     *  app shows when the ships set out. Every targeted seat not counted out sees `revealNodes`
     *  around each ship under way, 0 for none. */
    landings: z
      .strictObject({
        vehicle: z.string().min(1),
        menPerShip: count,
        noticeKey: MapEscalationNoticeKey,
        revealNodes: count.default(0),
      })
      .optional(),
    /** The fortress seat's catapults standing at the first turn come back at their spot this long
     *  after one is lost, one per guard refill beat, while the keep stands. */
    catapults: z.strictObject({ respawnSeconds: z.number().int().positive() }).optional(),
    /** The fortress seat's builders kept at `count`, the missing ones made at the keep on each guard
     *  refill beat while the fortress holds; the seat's map-AI town pass sends them to its sites. */
    builders: z.strictObject({ count }).optional(),
    /** The fortress seat's porters: up to `count` carriers posted at its storehouse nearest the keep,
     *  each pulling a `vehicle` hauling cart (a content vehicle slug) and holding a flag at (`x`, `y`)
     *  whose area reaches `radius` half-cell nodes (Manhattan, as any flag's work area), so they carry
     *  the goods lying there into the store. Made at the keep, cart and post included, on each guard
     *  refill beat while the fortress holds; a porter whose cart is gone gets a new one. */
    porters: z
      .strictObject({ count, vehicle: z.string().min(1), x: mapPoint, y: mapPoint, radius: count })
      .optional(),
    /** The fortress seat's towers, each of its finished buildings with a post for a slot's trade, manned
     *  with `slots`, each capped at the building's posts for it. The missing men are made at the keep and
     *  posted on each guard refill beat while the fortress holds, so a lost man is replaced and a tower
     *  raised again is manned again. The seat's map-AI posting keeps them on the wall, gear steps leave
     *  their weapons, and they stand outside the guard's count. */
    towerGarrison: z.strictObject({ slots: z.array(MapEscalationTowerSlot).min(1) }).optional(),
    /** The defenders placed once, at match start. None comes back. */
    heroes: z.array(MapEscalationHero).default([]),
    /** A fallen character of one of `seats` drops nothing: everything it wore and carried stays with
     *  its bones. */
    withheldDeathDrops: z.strictObject({ seats: z.array(seat).min(1) }).optional(),
    /** At match start every soldier of a seat the computer player runs becomes a civilian, so the
     *  seat builds up with them; human, idle and map-scripted seats keep theirs. */
    demobilizeComputerSeats: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!ascending(value.attacks.launches.map((row) => row.atSeconds)))
      ctx.addIssue({ code: 'custom', path: ['attacks', 'launches'], message: 'launches must ascend' });
    if (value.gear !== undefined && !ascending(value.gear.steps.map((row) => row.atSeconds)))
      ctx.addIssue({ code: 'custom', path: ['gear', 'steps'], message: 'gear steps must ascend' });
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
    if (raiders.includes(value.keep.seat))
      ctx.addIssue({ code: 'custom', path: ['attacks', 'targets'], message: 'the keep seat is a raider' });
    if (raiders.some((raider) => seats.has(raider)))
      ctx.addIssue({ code: 'custom', path: ['attacks', 'targets'], message: 'a raider seat is a target' });
  });
export type MapEscalation = z.infer<typeof MapEscalation>;
export type MapEscalationInput = z.input<typeof MapEscalation>;
