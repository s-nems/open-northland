import type { MapSiege } from '@open-northland/data';
import { mapEscalationProgress, Owner, Settler, writeMapEscalation } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import { ownedSettlers } from '../ai-shared/seat-roster.js';
import { towerPostFor } from '../conflict/tower-post.js';
import type { System, SystemContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { noteLostCatapults, rememberCatapults, respawnCatapult } from './catapults.js';
import { keepBuilders, keepPorters } from './crew.js';
import { demobilizeTurn } from './demobilize.js';
import { enlistAttackMan, focusTurn } from './focus.js';
import { gearTurn } from './gear.js';
import { placeHeroes } from './heroes.js';
import { fortressHolds, keepStands, occupiedTargets, siegeJobs, spawnAtKeep } from './keep.js';
import { landingsTurn, launchLandings, revealShips } from './landings.js';
import { attackBeaten, attackEndsTick, guardCap, launchTick, refillMen, waveSize } from './schedule.js';
import { keepTowerGarrison } from './towers.js';

/** Ticks between two checks of whether the running attack lost enough men, of its aims, of the
 *  landing ships and of lost catapults. */
const END_CHECK_TICKS = TICKS_PER_SECOND;

/**
 * The map's modules (`ctx.mapModules`), each run while it is present: the start's optional
 * demobilizing, the placed defenders, the siege and the gear steps. The siege sends scheduled attacks
 * from the stronghold against every occupied target seat, by land and by sea, and on each refill beat
 * keeps up the guard, catapults, crew and tower archers while the stronghold holds. Nothing spawns at
 * the stronghold while no finished keep stands.
 */
export const mapEscalationSystem: System = (world, ctx) => {
  const modules = ctx.mapModules;
  if (modules === undefined) return;
  if (modules.demobilizedStart !== undefined) demobilizeTurn(world, ctx);
  if (modules.heroes !== undefined) placeHeroes(world, ctx, modules.heroes);
  if (modules.siege !== undefined) siegeTurn(world, ctx, modules.siege);
  if (modules.gearSchedule !== undefined) gearTurn(world, ctx, modules.gearSchedule);
};

function siegeTurn(world: World, ctx: SystemContext, siege: MapSiege): void {
  const catapults = siege.catapults;
  if (catapults !== undefined && mapEscalationProgress(world).catapults === null)
    rememberCatapults(world, ctx, siege);
  const progress = mapEscalationProgress(world);
  const checkBeat = ctx.tick % END_CHECK_TICKS === 0;
  if (checkBeat) {
    const spent = focusTurn(world, ctx, siege);
    if (progress.attack !== null) checkAttackEnd(world, ctx, siege, spent);
  }
  if (checkBeat) landingsTurn(world, ctx, siege);
  revealShips(world, ctx, siege);
  if (catapults !== undefined && checkBeat) noteLostCatapults(world, ctx, siege);
  if (ctx.tick >= launchTick(siege, progress.launches)) launch(world, ctx, siege, progress.launches);
  const refill = refillMen(siege, ctx.tick);
  if (refill > 0 && fortressHolds(world, ctx.content, siege)) {
    refillGuard(world, ctx, siege, refill);
    if (catapults !== undefined) respawnCatapult(world, ctx, siege, catapults.respawnSeconds);
    if (siege.builders !== undefined) keepBuilders(world, ctx, siege, siege.builders);
    if (siege.porters !== undefined) keepPorters(world, ctx, siege, siege.porters);
    if (siege.towerGarrison !== undefined) keepTowerGarrison(world, ctx, siege, siege.towerGarrison);
  }
}

function launch(world: World, ctx: SystemContext, siege: MapSiege, index: number): void {
  const wave = index + 1;
  writeMapEscalation(world, (progress) => {
    progress.launches = wave;
  });
  if (!keepStands(world, ctx.content, siege)) return;
  const size = waveSize(siege, index);
  const jobs = siegeJobs(ctx, siege, size.landMen);
  const seaJobs = siegeJobs(ctx, siege, size.ships > 0 ? (siege.landings?.menPerShip ?? 0) : 0);
  const seats: number[] = [];
  const landed: number[] = [];
  const men: Entity[] = [];
  for (const target of occupiedTargets(world, siege)) {
    seats.push(target.seat);
    const band = spawnBand(world, ctx, siege, jobs, target.raider);
    for (const e of band) enlistAttackMan(world, e);
    men.push(...band);
    const aboard = launchLandings(world, ctx, siege, target, size.ships, seaJobs);
    if (aboard.length > 0) landed.push(target.seat);
    men.push(...aboard);
  }
  if (men.length === 0) return;
  // A schedule that launches before the last attack ran out ends that one first.
  if (mapEscalationProgress(world).attack !== null) endAttack(world, ctx, 'expired');
  writeMapEscalation(world, (progress) => {
    progress.attack = { wave, launchedTick: ctx.tick, sent: men.length, men: men.sort((a, b) => a - b) };
  });
  const attackNotice = siege.attacks.launches[index]?.notice ?? siege.attacks.notice;
  ctx.events.emit({
    kind: 'mapEscalationAttackLaunched',
    wave,
    seats,
    ...(attackNotice === undefined ? {} : { notice: attackNotice }),
  });
  const landingNotice = siege.landings?.notice;
  if (landed.length > 0 && landingNotice !== undefined)
    ctx.events.emit({ kind: 'mapEscalationLanding', wave, seats: landed, notice: landingNotice });
}

/**
 * End the attack once enough of its men are dead or its time ran out. The men against a `spent` seat,
 * one with nothing left to attack, no longer hold it: they count as lost and stand where they are.
 */
function checkAttackEnd(world: World, ctx: SystemContext, siege: MapSiege, spent: ReadonlySet<number>): void {
  const attack = mapEscalationProgress(world).attack;
  if (attack === null) return;
  const spentRaiders = new Set(
    siege.attacks.targets.filter((target) => spent.has(target.seat)).map((target) => target.raider),
  );
  const living = attack.men.filter(
    (e) => world.isAlive(e) && !spentRaiders.has(world.tryGet(e, Owner)?.player ?? -1),
  );
  if (attackBeaten(siege, attack.sent, living.length)) {
    endAttack(world, ctx, 'defeated');
    return;
  }
  if (ctx.tick >= attackEndsTick(siege, attack.launchedTick)) {
    endAttack(world, ctx, 'expired');
    return;
  }
  if (living.length === attack.men.length) return;
  writeMapEscalation(world, (progress) => {
    if (progress.attack !== null) progress.attack.men = living;
  });
}

/** `defeated`: enough of the men it sent are dead or have nothing left to attack; `expired`: its time
 *  ran out. Survivors fight on. */
function endAttack(world: World, ctx: SystemContext, cause: 'defeated' | 'expired'): void {
  const attack = mapEscalationProgress(world).attack;
  if (attack === null) return;
  const wave = attack.wave;
  writeMapEscalation(world, (progress) => {
    progress.attack = null;
  });
  ctx.events.emit({ kind: 'mapEscalationAttackEnded', wave, cause });
}

function refillGuard(world: World, ctx: SystemContext, siege: MapSiege, men: number): void {
  const seat = siege.stronghold.seat;
  const cap = guardCap(siege, ctx.tick, occupiedTargets(world, siege).length);
  const room = cap - fieldSoldiers(world, ctx, seat);
  if (room <= 0) return;
  spawnBand(world, ctx, siege, siegeJobs(ctx, siege, Math.min(men, room)), seat);
}

/** The seat's soldiers off its towers: the guard the cap counts, the tower garrisons standing apart. */
function fieldSoldiers(world: World, ctx: SystemContext, seat: number): number {
  let count = 0;
  for (const e of ownedSettlers(world, seat)) {
    const jobType = world.get(e, Settler).jobType;
    if (
      jobType !== null &&
      isFighterJob(ctx.content, jobType) &&
      towerPostFor(world, ctx, e, jobType) === null
    )
      count++;
  }
  return count;
}

function spawnBand(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
  jobs: readonly number[],
  owner: number,
): Entity[] {
  const spawned: Entity[] = [];
  for (const jobType of jobs) {
    const e = spawnAtKeep(world, ctx, siege, jobType, owner);
    if (e !== null) spawned.push(e);
  }
  return spawned;
}
