import type { MapEscalation } from '@open-northland/data';
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
import { fortressHolds, keepStands, occupiedTargets, spawnAtKeep } from './keep.js';
import { landingsTurn, launchLandings, revealShips } from './landings.js';
import {
  apportion,
  attackBeaten,
  attackEndsTick,
  guardCap,
  launchTick,
  refillMen,
  waveSize,
} from './schedule.js';
import { keepTowerGarrison } from './towers.js';

/** Ticks between two checks of whether the running attack lost enough men, of its aims, of the
 *  landing ships and of lost catapults. */
const END_CHECK_TICKS = TICKS_PER_SECOND;

/**
 * A map's escalating siege (`ctx.mapEscalation`): scheduled attacks from the fortress keep against every
 * occupied target seat, by land and by sea, and on each refill beat the guard, catapults, crew and tower
 * archers kept up while the fortress holds, besides its gear steps, placed defenders and optional start
 * demobilizing. Nothing spawns at the keep while no finished keep stands.
 */
export const mapEscalationSystem: System = (world, ctx) => {
  const config = ctx.mapEscalation;
  if (config === undefined) return;
  if (config.demobilizeComputerSeats) demobilizeTurn(world, ctx);
  if (config.heroes.length > 0) placeHeroes(world, ctx, config);
  const catapults = config.catapults;
  if (catapults !== undefined && mapEscalationProgress(world).catapults === null)
    rememberCatapults(world, ctx, config);
  const progress = mapEscalationProgress(world);
  const checkBeat = ctx.tick % END_CHECK_TICKS === 0;
  if (checkBeat) {
    const spent = focusTurn(world, ctx, config);
    if (progress.attack !== null) checkAttackEnd(world, ctx, config, spent);
  }
  if (checkBeat) landingsTurn(world, ctx, config);
  revealShips(world, ctx, config);
  if (catapults !== undefined && checkBeat) noteLostCatapults(world, ctx, config);
  if (ctx.tick >= launchTick(config, progress.launches)) launch(world, ctx, config, progress.launches);
  const refill = refillMen(config, ctx.tick);
  if (refill > 0 && fortressHolds(world, config)) {
    refillGuard(world, ctx, config, refill);
    if (catapults !== undefined) respawnCatapult(world, ctx, config, catapults.respawnSeconds);
    if (config.builders !== undefined) keepBuilders(world, ctx, config, config.builders);
    if (config.porters !== undefined) keepPorters(world, ctx, config, config.porters);
    if (config.towerGarrison !== undefined) keepTowerGarrison(world, ctx, config, config.towerGarrison);
  }
  if (config.gear !== undefined) gearTurn(world, ctx, config.gear);
};

function launch(world: World, ctx: SystemContext, config: MapEscalation, index: number): void {
  const wave = index + 1;
  writeMapEscalation(world, (progress) => {
    progress.launches = wave;
  });
  if (!keepStands(world, config)) return;
  const size = waveSize(config, index);
  const jobs = apportion(config.jobMix, size.landMen);
  const seaJobs = apportion(config.jobMix, size.ships > 0 ? (config.landings?.menPerShip ?? 0) : 0);
  const seats: number[] = [];
  const landed: number[] = [];
  const men: Entity[] = [];
  for (const target of occupiedTargets(world, config)) {
    seats.push(target.seat);
    const band = spawnBand(world, ctx, config, jobs, target.raider);
    for (const e of band) enlistAttackMan(world, e);
    men.push(...band);
    const aboard = launchLandings(world, ctx, config, target, size.ships, seaJobs);
    if (aboard.length > 0) landed.push(target.seat);
    men.push(...aboard);
  }
  if (men.length === 0) return;
  // A schedule that launches before the last attack ran out ends that one first.
  if (mapEscalationProgress(world).attack !== null) endAttack(world, ctx, 'expired');
  writeMapEscalation(world, (progress) => {
    progress.attack = { wave, launchedTick: ctx.tick, sent: men.length, men: men.sort((a, b) => a - b) };
  });
  const attackNotice = config.attacks.launches[index]?.noticeKey ?? config.attacks.noticeKey;
  ctx.events.emit({
    kind: 'mapEscalationAttackLaunched',
    wave,
    seats,
    ...(attackNotice === undefined ? {} : { noticeKey: attackNotice }),
  });
  const landingNotice = config.landings?.noticeKey;
  if (landed.length > 0 && landingNotice !== undefined)
    ctx.events.emit({ kind: 'mapEscalationLanding', wave, seats: landed, noticeKey: landingNotice });
}

/**
 * End the attack once enough of its men are dead or its time ran out. The men against a `spent` seat,
 * one with nothing left to attack, no longer hold it: they count as lost and stand where they are.
 */
function checkAttackEnd(
  world: World,
  ctx: SystemContext,
  config: MapEscalation,
  spent: ReadonlySet<number>,
): void {
  const attack = mapEscalationProgress(world).attack;
  if (attack === null) return;
  const spentRaiders = new Set(
    config.attacks.targets.filter((target) => spent.has(target.seat)).map((target) => target.raider),
  );
  const living = attack.men.filter(
    (e) => world.isAlive(e) && !spentRaiders.has(world.tryGet(e, Owner)?.player ?? -1),
  );
  if (attackBeaten(config, attack.sent, living.length)) {
    endAttack(world, ctx, 'defeated');
    return;
  }
  if (ctx.tick >= attackEndsTick(config, attack.launchedTick)) {
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

function refillGuard(world: World, ctx: SystemContext, config: MapEscalation, men: number): void {
  const seat = config.keep.seat;
  const cap = guardCap(config, ctx.tick, occupiedTargets(world, config).length);
  const room = cap - fieldSoldiers(world, ctx, seat);
  if (room <= 0) return;
  spawnBand(world, ctx, config, apportion(config.jobMix, Math.min(men, room)), seat);
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
  config: MapEscalation,
  jobs: readonly number[],
  owner: number,
): Entity[] {
  const spawned: Entity[] = [];
  for (const jobType of jobs) {
    const e = spawnAtKeep(world, ctx, config, jobType, owner);
    if (e !== null) spawned.push(e);
  }
  return spawned;
}
