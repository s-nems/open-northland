import {
  Building,
  computerControllerRuns,
  DefenceMode,
  DiplomacyRules,
  fightsPlayer,
  Garrison,
  Health,
  MAX_PLAYERS,
  Owner,
  PeaceRules,
  Person,
  Position,
  Settler,
  Weapon,
} from '../../../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween, nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { SIGHT_RADIUS_NODES } from '../../../conflict/targeting.js';
import { garrisonReach, mannedPostOf, standsAtPost } from '../../../conflict/tower-post.js';
import { attackerWeapon } from '../../../conflict/weapons.js';
import type { SystemContext } from '../../../context.js';
import { ownedFighters } from '../../../movement/collision/owned-fighters.js';
import { houseBow } from '../../../readviews/index.js';
import { interactionCell } from '../../../settlers/targets/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { fogHides, playerSeesNode } from '../../../vision/gates.js';
import type { FogState } from '../../../vision/state.js';

/** An enemy fighter, at the node he stands on this decision, with the walkable component that node
 *  belongs to - the seat can shelter from a man it cannot reach, but it cannot march out at him - and
 *  how far he strikes from there ({@link Shooter}). */
export interface Raider extends Shooter {
  readonly entity: Entity;
  readonly component: number;
  /** What an attack on his fire strikes: the man himself. */
  readonly target: Entity;
}

/** An enemy fighter's node and reach: how far from it his swing or shot lands, in Manhattan nodes. A loose
 *  man's is at least his sight, since he advances on what he sees; a posted man's is his bow's with the
 *  tower's bonus, and he never leaves it. */
export interface Shooter {
  readonly x: number;
  readonly y: number;
  readonly reach: number;
}

/** A {@link Shooter} holding an enemy tower post, with the tower he shoots from. */
export interface PostedShooter extends Shooter {
  readonly tower: Entity;
  /** What an attack on his fire strikes: the tower. */
  readonly target: Entity;
}

/** The enemy's fire over the map, narrowed to the shooters a search can meet before it runs its test. */
export interface EnemyFire {
  /** Whether a site anchored on `(x, y)`, its walls up to `span` nodes out from the anchor, stands inside
   *  some shooter's reach. Linear in the shooters, so narrow it first. */
  reaches(x: number, y: number, span: number): boolean;
  /** The same fire over only the shooters whose reach, plus `span`, meets the Manhattan disc of `radius`
   *  around `(x, y)`: what a search fanning that far from its centre can meet at all, usually nobody. */
  around(x: number, y: number, radius: number, span: number): EnemyFire;
}

/** How far past its watch band ({@link threatWatchNodes}) a raider must draw off before the seat stands
 *  down. Without the margin a fighter pacing the rim would flick the town's economy in and out of cover
 *  every decision. */
export const THREAT_STAND_DOWN_MARGIN_NODES = 6;

/** The house bow's extracted `maximumrange` (`weapons.ini` type 20), for content that declares no wall bow
 *  and whose shelters therefore take their people in unarmed - they still have to be indoors in time. */
const HOUSE_BOW_REACH_NODES = 29;

/** How close a raider comes before a building of `tribe` counts as threatened: the reach of the bow it
 *  fires once its people are inside ({@link houseBow}), at its plain range; the tower bonus belongs to the
 *  employed post. */
export function threatWatchNodes(ctx: SystemContext, tribe: number): number {
  return houseBow(ctx.content, tribe)?.maxRange ?? HOUSE_BOW_REACH_NODES;
}

/**
 * The band `building` watches this decision, widened by {@link THREAT_STAND_DOWN_MARGIN_NODES} while its
 * alarm already stands.
 *
 * The alarm and the sortie read the same band on purpose. A raider inside the margin but outside the plain
 * reach holds the town in cover while standing where nothing indoors can shoot him, so he has to be
 * somebody the seat comes out at - otherwise one man shuts a settlement down for good.
 */
export function watchBandOf(world: World, ctx: SystemContext, building: Entity): number {
  const watch = threatWatchNodes(ctx, world.get(building, Building).tribe);
  return world.has(building, DefenceMode) ? watch + THREAT_STAND_DOWN_MARGIN_NODES : watch;
}

/**
 * Every enemy fighter loose on the map, canonical ascending id. Fighting trades only, so a colonist walking
 * past a tower is not a raid, and the {@link Person} key keeps a claimed herd out.
 *
 * A man holding his own tower is dropped because `conflict/targeting.ts` refuses him as a target: a
 * garrison parked within reach of this seat's edge would otherwise hold the town in cover forever.
 *
 * A seat whose computer controller runs keeps only the men it sees now ({@link sightOf}); the scripted
 * map AI's seats see every one. One scan a tick per seat, shared by every reader in that tick. The list
 * is rewritten in place by the seat's next rescan: read it within the decision, never keep it.
 */
export function seatRaiders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): readonly Raider[] {
  const fighters = looseFighters(world, ctx, terrain);
  let scans = raiderScans.get(world);
  if (scans === undefined) {
    scans = new Map();
    raiderScans.set(world, scans);
  }
  const sight = sightOf(world, ctx, player);
  const view = sight === null ? UNGATED_VIEW : sight.viewGeneration(player);
  let held = scans.get(player);
  if (held === undefined) {
    held = { stamp: fighters.stamp - 1, view, raiders: [] };
    scans.set(player, held);
  }
  if (held.stamp !== fighters.stamp || held.view !== view) {
    enemiesAmong(world, fighters.fighters, player, sight, held.raiders);
    held.stamp = fighters.stamp;
    held.view = view;
  }
  return held.raiders;
}

/** One seat's raider scan, kept while the fighter scan it was read from and the seat's view stand: the
 *  build order and the military module both read a seat's raiders in its decision tick. Derived
 *  read-state, never hashed. */
interface RaiderScan {
  stamp: number;
  /** The fog's {@link FogState.viewGeneration} for the seat when its scan is gated, else
   *  {@link UNGATED_VIEW}. */
  view: number;
  readonly raiders: Raider[];
}

/** {@link RaiderScan.view} of a scan no fog gates; below every view generation. */
const UNGATED_VIEW = -1;

/**
 * The fog a seat's enemy reads are gated by, or null when it sees every enemy: a seat whose computer
 * controller runs plays by its own sight under a fog that hides anything; the scripted map AI does not.
 */
export function sightOf(world: World, ctx: SystemContext, player: number): FogState | null {
  return fogHides(ctx.fog) && computerControllerRuns(world, player) ? ctx.fog : null;
}

const raiderScans = new WeakMap<World, Map<number, RaiderScan>>();

/** A live, unposted fighter of any seat, read once for every seat's {@link seatRaiders}: the raider record
 *  a seat's list hands out, with the owner the stance test reads. A rescan keeps the previous record of a
 *  man whose owner, node and reach are unchanged, so a standing army costs no allocation per scan. */
interface LooseFighter extends Raider {
  readonly owner: number;
}

/**
 * The map's loose fighters under one scan key, ascending id, rebuilt in place. `fighters` never leaves this
 * module, so a rescan writes into `spare` and swaps the two lists. `stamp` moves on every rescan, for the
 * seat scans read off it. Derived read-state, never hashed.
 *
 * A rescan re-derives only the men the feeds saw change, and every posted man, whose post test also reads
 * the tower's own position: `records[e]` is `e`'s last derivation, null when he was no loose fighter, and
 * `flags[e]` says what was written since ({@link STALE}, {@link MOVED}) and whether he held a post then
 * ({@link POSTED}): the Garrison marker's membership is a written store, so the bit cannot go stale.
 */
interface LooseFighterScan {
  readonly key: number[];
  stamp: number;
  content: SystemContext['content'];
  terrain: TerrainGraph;
  /** The context of the last rescan, for the cache verifier's fresh derivation. */
  ctx: SystemContext;
  fighters: LooseFighter[];
  spare: LooseFighter[];
  readonly records: (LooseFighter | null | undefined)[];
  flags: Uint8Array;
  /** Every write to a {@link RECORD_STORES} store but a Position value write. */
  readonly feed: ChangeFeed;
  /** Position value writes: a man who only walked keeps his reach and owner. */
  readonly moves: ChangeFeed;
}

/** {@link LooseFighterScan.flags} bits: some write the record reads, a Position value write, and a
 *  Garrison marker at the last derivation. */
const STALE = 1;
const MOVED = 2;
const POSTED = 4;

const looseFighterScans = new WeakMap<World, LooseFighterScan>();

/** Every store the scan reads, membership and in-place writes: a man born, killed, moved, re-owned,
 *  re-jobbed, re-armed or posted, or a stance changed or a peace ended, starts a fresh scan. */
const SCAN_STORES = [
  Person,
  Owner,
  Position,
  Health,
  Settler,
  Weapon,
  Garrison,
  DiplomacyRules,
  PeaceRules,
] as const;

/** The stores one man's {@link LooseFighter} record is derived from: a write to any re-derives his. */
const RECORD_STORES = [Person, Owner, Position, Health, Settler, Weapon, Garrison] as const;
const RECORD_VALUE_STORES = [Person, Owner, Health, Settler, Weapon, Garrison] as const;

/** Writes the live {@link SCAN_STORES} generations into `key`. */
function fillKey(world: World, key: number[]): void {
  let i = 0;
  for (const store of SCAN_STORES) {
    key[i++] = world.componentGeneration(store);
    key[i++] = world.componentValueGeneration(store);
  }
}

/** Whether `key` still matches the live {@link SCAN_STORES} generations, read without building a key. */
function keyIsCurrent(world: World, key: readonly number[]): boolean {
  let i = 0;
  for (const store of SCAN_STORES) {
    if (key[i++] !== world.componentGeneration(store)) return false;
    if (key[i++] !== world.componentValueGeneration(store)) return false;
  }
  return true;
}

function looseFighters(world: World, ctx: SystemContext, terrain: TerrainGraph): LooseFighterScan {
  let scan = looseFighterScans.get(world);
  if (scan === undefined) {
    scan = {
      key: [],
      stamp: 0,
      content: ctx.content,
      terrain,
      ctx,
      fighters: [],
      spare: [],
      records: [],
      flags: new Uint8Array(0),
      feed: world.watchChanges(RECORD_STORES, RECORD_VALUE_STORES),
      moves: world.watchChanges([], [Position]),
    };
    looseFighterScans.set(world, scan);
    world.registerCacheVerifier('looseFighters', () => verifyLooseFighters(world));
  } else if (scan.content === ctx.content && scan.terrain === terrain && keyIsCurrent(world, scan.key)) {
    return scan;
  }
  fillKey(world, scan.key);
  const held = scan;
  const mark = (e: Entity, bit: number): void => {
    if (e >= held.flags.length) held.flags = grownFlags(held.flags, e);
    held.flags[e] = (held.flags[e] as number) | bit;
  };
  const overflowed = held.feed.drain((e) => mark(e, STALE)) || held.moves.drain((e) => mark(e, MOVED));
  if (overflowed || scan.content !== ctx.content || scan.terrain !== terrain) {
    scan.records.fill(undefined);
    // The other feed may still hold entries; a cleared record re-derives whatever they name.
    held.feed.drain(() => {});
    held.moves.drain(() => {});
  }
  const { records } = scan;
  const roster = ownedFighters(world, ctx.content);
  const last = roster[roster.length - 1];
  if (last !== undefined && last >= records.length) growRecords(records, last);
  const fighters = scan.spare;
  let n = 0;
  // The owned-fighter index holds every owned settler of a fighting trade, ascending id: the fighters among
  // the people, without a walk over every civilian.
  for (const e of roster) {
    let record = records[e];
    const flags = e < scan.flags.length ? (scan.flags[e] as number) : 0;
    if (record === undefined || (flags & (STALE | POSTED)) !== 0) {
      record = looseFighterOf(world, ctx, terrain, e, record ?? null);
      records[e] = record;
      const posted = world.has(e, Garrison) ? POSTED : 0;
      if (posted !== flags) {
        if (e >= scan.flags.length) scan.flags = grownFlags(scan.flags, e);
        scan.flags[e] = posted;
      }
    } else if (flags !== 0) {
      // Unposted and still standing, so only his place can have changed.
      if (record !== null) {
        record = placed(world, terrain, record);
        records[e] = record;
      }
      scan.flags[e] = 0;
    }
    if (record !== null) fighters[n++] = record;
  }
  fighters.length = n;
  scan.spare = scan.fighters;
  scan.fighters = fighters;
  scan.content = ctx.content;
  scan.terrain = terrain;
  scan.ctx = ctx;
  scan.stamp++;
  return scan;
}

/** `e`'s loose-fighter record, or null when he is dead, placeless or standing at a post. `was`, his last
 *  record, is handed back when nothing it holds changed, so a standing army costs no allocation. */
function looseFighterOf(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  was: LooseFighter | null,
): LooseFighter | null {
  if (!world.has(e, Person) || !world.has(e, Position)) return null;
  if ((world.tryGet(e, Health)?.hitpoints ?? 0) <= 0) return null;
  if (standsAtPost(world, e) !== null) return null;
  const p = world.get(e, Position);
  const x = terrain.clampX(nodeHxOfPosition(p.x, p.y));
  const y = terrain.clampY(nodeHyOfPosition(p.x, p.y));
  const component = terrain.componentOf(terrain.nodeAtClamped(x, y));
  const reach = Math.max(weaponReach(world, ctx, e), SIGHT_RADIUS_NODES);
  const owner = world.get(e, Owner).player;
  return was !== null && sameFighter(was, e, owner, x, y, component, reach)
    ? was
    : { entity: e, target: e, x, y, component, reach, owner };
}

/** `was` at its man's current node: the same record when he stands where it says. */
function placed(world: World, terrain: TerrainGraph, was: LooseFighter): LooseFighter {
  const p = world.get(was.entity, Position);
  const x = terrain.clampX(nodeHxOfPosition(p.x, p.y));
  const y = terrain.clampY(nodeHyOfPosition(p.x, p.y));
  const component = terrain.componentOf(terrain.nodeAtClamped(x, y));
  return x === was.x && y === was.y && component === was.component ? was : { ...was, x, y, component };
}

/** Extends `records` with empty slots past `index`, doubling, so the list stays a packed array rather than
 *  one first written at a high id. */
function growRecords(records: (LooseFighter | null | undefined)[], index: number): void {
  const length = Math.max(index + 1, records.length * 2);
  for (let i = records.length; i < length; i++) records.push(undefined);
}

function grownFlags(flags: Uint8Array, index: number): Uint8Array {
  const next = new Uint8Array(Math.max(index + 1, flags.length * 2));
  next.set(flags);
  return next;
}

/** Compares a current scan with a fresh derivation of every owned fighter. */
function verifyLooseFighters(world: World): string[] {
  const scan = looseFighterScans.get(world);
  if (scan === undefined || !keyIsCurrent(world, scan.key)) return [];
  const fresh: LooseFighter[] = [];
  for (const e of ownedFighters(world, scan.content)) {
    const record = looseFighterOf(world, scan.ctx, scan.terrain, e, null);
    if (record !== null) fresh.push(record);
  }
  const listed = scan.fighters;
  const length = Math.max(listed.length, fresh.length);
  for (let i = 0; i < length; i++) {
    const f = listed[i];
    const g = fresh[i];
    if (
      f !== undefined &&
      g !== undefined &&
      sameFighter(f, g.entity, g.owner, g.x, g.y, g.component, g.reach)
    )
      continue;
    const entity = g?.entity ?? f?.entity;
    return [
      `looseFighters differs from a fresh scan at entity ${entity}: listed ${JSON.stringify(f)}, fresh ${JSON.stringify(g)}`,
    ];
  }
  return [];
}

function sameFighter(
  was: LooseFighter,
  e: Entity,
  owner: number,
  x: number,
  y: number,
  component: number,
  reach: number,
): boolean {
  return (
    was.entity === e &&
    was.owner === owner &&
    was.x === x &&
    was.y === y &&
    was.component === component &&
    was.reach === reach
  );
}

/** Rewrites `raiders` in place to the `fighters` whose player would engage `player`, in their order: an
 *  allied army walking past must not hold the town in alarm. */
function enemiesAmong(
  world: World,
  fighters: readonly LooseFighter[],
  player: number,
  sight: FogState | null,
  raiders: Raider[],
): void {
  stanceOf.fill(UNREAD);
  let count = 0;
  for (const fighter of fighters) {
    if (!engages(world, fighter.owner, player)) continue;
    if (sight !== null && !playerSeesNode(sight, player, fighter.x, fighter.y)) continue;
    raiders[count++] = fighter;
  }
  raiders.length = count;
}

/** {@link enemiesAmong}'s stances this call, by owner slot: {@link UNREAD}, or 1 for an enemy and 0 not. */
const stanceOf = new Int8Array(MAX_PLAYERS);
const UNREAD = -1;

/** Whether `owner`'s fighters are `player`'s raiders, the stance read once per owner per call. */
function engages(world: World, owner: number, player: number): boolean {
  if (owner === player) return false;
  if (owner < 0 || owner >= MAX_PLAYERS) return fightsPlayer(world, owner, player);
  let stance = stanceOf[owner] as number;
  if (stance === UNREAD) {
    stance = fightsPlayer(world, owner, player) ? 1 : 0;
    stanceOf[owner] = stance;
  }
  return stance === 1;
}

/** The weapon `e` fights with and its reach band, or null for an unarmed man. */
function heldWeapon(world: World, ctx: SystemContext, e: Entity): ReturnType<typeof attackerWeapon> {
  const settler = world.get(e, Settler);
  return attackerWeapon(
    ctx,
    settler.tribe,
    settler.jobType,
    world.tryGet(e, Weapon)?.weaponTypeId,
    settler.humanForm,
  );
}

/** The far reach of the weapon `e` fights with, 0 for an unarmed man. */
function weaponReach(world: World, ctx: SystemContext, e: Entity): number {
  return heldWeapon(world, ctx, e)?.maxRange ?? 0;
}

/**
 * Every enemy fighter manning a tower post, with the post's boosted reach: the fortification the raider
 * scan leaves out, which still shoots a site raised inside its band. Read off the garrison markers, so
 * the walk is over the few posted men, not over every person. A seat whose computer controller runs
 * keeps only the posts it sees now ({@link sightOf}). A fresh list per call, of records kept per man
 * while his tower, node and reach stand.
 */
export function enemyPosts(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
): PostedShooter[] {
  let kept = postRecords.get(world);
  if (kept === undefined) {
    kept = new Map();
    postRecords.set(world, kept);
  }
  stanceOf.fill(UNREAD);
  const sight = sightOf(world, ctx, player);
  const posts: PostedShooter[] = [];
  for (const e of world.query(Garrison)) {
    const owner = world.tryGet(e, Owner)?.player;
    if (owner === undefined || !engages(world, owner, player)) continue;
    const tower = (world.tryGet(e, Health)?.hitpoints ?? 0) > 0 ? mannedPostOf(world, ctx, e) : null;
    const held = tower === null ? null : heldWeapon(world, ctx, e);
    if (tower === null || held === null || held.maxRange === 0) {
      kept.delete(e);
      continue;
    }
    const at = entityNode(world, terrain, e);
    const x = terrain.xOf(at);
    const y = terrain.yOf(at);
    // Out of sight he is not listed, but his record stays for when he is seen again.
    if (sight !== null && !playerSeesNode(sight, player, x, y)) continue;
    const reach = garrisonReach(held).maxRange;
    let post = kept.get(e);
    if (post === undefined || post.tower !== tower || post.x !== x || post.y !== y || post.reach !== reach) {
      post = { tower, target: tower, x, y, reach };
      kept.set(e, post);
    }
    posts.push(post);
  }
  return posts;
}

/** Each posted man's last {@link PostedShooter}, handed out again while it still describes him, and dropped
 *  once a read finds him holding no post. Never hashed. */
const postRecords = new WeakMap<World, Map<Entity, PostedShooter>>();

/** The {@link EnemyFire} of every shooter in `shooters` and `more`, loose or posted, whatever ground he
 *  stands on: a bow shoots across water. Reach counts map points, as the bow does. Two lists, so the
 *  map's raiders are not copied to join the posts. */
export function enemyFire(shooters: readonly Shooter[], more: readonly Shooter[] = NO_SHOOTERS): EnemyFire {
  const within = (s: Shooter, x: number, y: number, extra: number): boolean =>
    hexDistanceBetween(s.x, s.y, x, y) <= s.reach + extra;
  return {
    reaches: (x, y, span) => anyWithin(shooters, x, y, span) || anyWithin(more, x, y, span),
    around: (x, y, radius, span) => {
      const near: Shooter[] = [];
      for (const s of shooters) if (within(s, x, y, radius + span)) near.push(s);
      for (const s of more) if (within(s, x, y, radius + span)) near.push(s);
      return enemyFire(near);
    },
  };
}

const NO_SHOOTERS: readonly Shooter[] = [];

function anyWithin(shooters: readonly Shooter[], x: number, y: number, extra: number): boolean {
  for (const s of shooters) if (hexDistanceBetween(s.x, s.y, x, y) <= s.reach + extra) return true;
  return false;
}

/**
 * The raider nearest `(x, y)` within `radius` map points, the measure of the bow reach the band is read
 * from, with his distance, or null when none is that close.
 * Candidates arrive ascending-id, so the strict `<` keeps the lowest id among equal distances.
 *
 * `reachable` is the walkable component a candidate must share, or null to take him wherever he stands:
 * the alarm answers anyone who can shoot into the town, while an order to go out at him cannot.
 */
export function nearestRaiderWithin(
  raiders: readonly Raider[],
  x: number,
  y: number,
  radius: number,
  reachable: number | null,
): { raider: Raider; distance: number } | null {
  let best: Raider | null = null;
  let bestDistance = 0;
  for (const raider of raiders) {
    if (reachable !== null && raider.component !== reachable) continue;
    const distance = hexDistanceBetween(raider.x, raider.y, x, y);
    if (distance > radius) continue;
    if (best === null || distance < bestDistance) {
      best = raider;
      bestDistance = distance;
    }
  }
  return best === null ? null : { raider: best, distance: bestDistance };
}

/**
 * The raider standing closest to anything the seat owns and can walk to, or null when nothing is at the
 * gates. Read off every building rather than the shelters alone, construction sites included: a band
 * burning the outlying farms is a raid, and a site is a building the seat is losing.
 *
 * A man on ground the building's door does not connect to is skipped. He may still hold the alarm up, but
 * answering him is impossible, and treating him as a raid would bench the campaign for a siege that can
 * never be joined. Ties break on the raider's id, so two buildings equidistant from two men cannot pick by
 * iteration order.
 */
export function raidOnTheSettlement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
): Raider | null {
  const near = raidersNearAny(world, ctx, terrain, owned, raiders);
  if (near.length === 0) return null;
  let best: { raider: Raider; distance: number } | null = null;
  for (const e of owned) {
    const at = entityNode(world, terrain, e);
    const door = terrain.componentOf(interactionCell(world, ctx, terrain, e));
    const found = nearestRaiderWithin(
      near,
      terrain.xOf(at),
      terrain.yOf(at),
      watchBandOf(world, ctx, e),
      door,
    );
    if (found === null) continue;
    if (
      best === null ||
      found.distance < best.distance ||
      (found.distance === best.distance && found.raider.entity < best.raider.entity)
    ) {
      best = found;
    }
  }
  return best?.raider ?? null;
}

/** The box round a seat's buildings widened by their widest watch band: a man outside it lies past every
 *  building's band, since a hex distance is never under the row span nor under the column span less one. */
export interface SettlementBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** The {@link SettlementBox} of `owned`, or null when it owns nothing. */
export function settlementBox(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
): SettlementBox | null {
  if (owned.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let band = 0;
  for (const e of owned) {
    const at = entityNode(world, terrain, e);
    const x = terrain.xOf(at);
    const y = terrain.yOf(at);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    band = Math.max(band, watchBandOf(world, ctx, e));
  }
  return { minX: minX - band - 1, maxX: maxX + band + 1, minY: minY - band, maxY: maxY + band };
}

export function insideBox(box: SettlementBox, x: number, y: number): boolean {
  return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
}

/** The `raiders` inside the {@link SettlementBox} of `owned`, in their order. */
export function raidersNearAny(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
): readonly Raider[] {
  if (raiders.length === 0) return [];
  const box = settlementBox(world, ctx, terrain, owned);
  return box === null ? [] : raiders.filter((r) => insideBox(box, r.x, r.y));
}
