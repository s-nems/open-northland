import type { MapGearSchedule } from '@open-northland/data';
import {
  Equipment,
  ensureEquipment,
  mapEscalationProgress,
  Owner,
  Settler,
  Stance,
  writeEquipSlot,
  writeMapEscalation,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ZERO } from '../../core/fixed.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import { ownedSettlers } from '../ai-shared/seat-roster.js';
import { towerPostFor } from '../conflict/tower-post.js';
import type { SystemContext } from '../context.js';
import { weaponKeepsLockedJob } from '../readviews/equip-pick.js';
import { isSoldierJob, mayChangeEquipment } from '../readviews/index.js';
import { takeUpWeaponGood } from '../settlers/atomics/effects/goods/weapon-class.js';
import { isEscalationHero } from './heroes.js';

type GearStep = MapGearSchedule['steps'][number];
type WeaponUpgrade = GearStep['weaponUpgrades'][number];

const PERCENT = 100;
/** Ticks between two looks at the entities created since the last one. */
const NEWCOMER_CHECK_TICKS = TICKS_PER_SECOND;

/**
 * The gear schedule: when a step falls due every soldier of the gear seats gets it, and every
 * soldier created for those seats later (a refill, a band, a script spawn) gets each step already passed,
 * within a second. Newcomers are found by entity id above a watermark, so the look costs the entities
 * created since the last one. A settler that becomes a gear seat's soldier by a trade or owner change is
 * not seen: a gear seat is a scripted camp that neither trains nor is handed people.
 */
export function gearTurn(world: World, ctx: SystemContext, gear: MapGearSchedule): void {
  const passed = mapEscalationProgress(world).gearSteps;
  const due = gear.steps[passed];
  const stepDue = due !== undefined && ctx.tick >= due.atSeconds * TICKS_PER_SECOND;
  // Before a step pass, so a soldier it reaches is not counted a newcomer again later.
  if (passed > 0 && (stepDue || ctx.tick % NEWCOMER_CHECK_TICKS === 0))
    gearNewcomers(world, ctx, gear, passed);
  if (!stepDue) return;
  const seats = new Set(gear.seats);
  for (const seat of seats) {
    for (const e of ownedSettlers(world, seat))
      if (isGearedSoldier(world, ctx, e)) grantStep(world, ctx, e, due);
  }
  const step = passed + 1;
  const below = world.nextEntityId;
  writeMapEscalation(world, (progress) => {
    progress.gearSteps = step;
    progress.gearedBelow = below;
  });
  ctx.events.emit({
    kind: 'mapEscalationGearStep',
    step,
    ...(due.notice === undefined ? {} : { notice: due.notice }),
  });
}

function gearNewcomers(world: World, ctx: SystemContext, gear: MapGearSchedule, passed: number): void {
  const from = mapEscalationProgress(world).gearedBelow;
  const below = world.nextEntityId;
  if (below <= from) return;
  const seats = new Set(gear.seats);
  for (let id = from; id < below; id++) {
    const e = id as Entity;
    if (!world.isAlive(e)) continue;
    const owner = world.tryGet(e, Owner)?.player;
    if (owner === undefined || !seats.has(owner) || !isGearedSoldier(world, ctx, e)) continue;
    for (const step of gear.steps.slice(0, passed)) grantStep(world, ctx, e, step);
  }
  writeMapEscalation(world, (progress) => {
    progress.gearedBelow = below;
  });
}

/** A soldier of a gear seat other than a placed defender, who keeps what he was placed with. */
function isGearedSoldier(world: World, ctx: SystemContext, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return (
    settler !== undefined &&
    isSoldierJob(ctx.content, settler.jobType) &&
    mayChangeEquipment(world, ctx.content, e) &&
    !isEscalationHero(world, e)
  );
}

/** The step's weapon upgrades, then its grants: each grant draws its chance, then one of its goods, then
 *  its extra chance for a different one. The good's equip category names the slot. A misc good takes the
 *  first free misc slot and is lost when none is free; a good without one is skipped. A man posted to a
 *  tower keeps his weapon, so the tower's split between its bow classes holds. */
function grantStep(world: World, ctx: SystemContext, e: Entity, step: GearStep): void {
  const jobType = world.get(e, Settler).jobType;
  const posted = jobType !== null && towerPostFor(world, ctx, e, jobType) !== null;
  if (!posted) for (const upgrade of step.weaponUpgrades) upgradeWeapon(world, ctx, e, upgrade);
  for (const grant of step.grants) {
    if (!rolls(ctx, grant.chancePct)) continue;
    const first = drawGood(ctx, grant.goods, undefined);
    giveGood(world, ctx, e, first);
    if (rolls(ctx, grant.extraChancePct)) giveGood(world, ctx, e, drawGood(ctx, grant.goods, first));
  }
}

/** A percent chance, drawn only when it is neither sure nor nil. */
function rolls(ctx: SystemContext, pct: number): boolean {
  if (pct >= PERCENT) return true;
  return pct > 0 && ctx.rng.int(PERCENT) < pct;
}

/** One of `goods` at random, other than `except`; a single candidate draws nothing, none gives nothing. */
function drawGood(
  ctx: SystemContext,
  goods: readonly string[],
  except: string | undefined,
): string | undefined {
  const candidates = except === undefined ? goods : goods.filter((slug) => slug !== except);
  if (candidates.length <= 1) return candidates[0];
  return candidates[ctx.rng.int(candidates.length)];
}

function giveGood(world: World, ctx: SystemContext, e: Entity, slug: string | undefined): void {
  const index = contentIndex(ctx.content);
  const goodType = slug === undefined ? undefined : index.goodTypeBySlug.get(slug);
  const category = goodType === undefined ? undefined : index.goods.get(goodType)?.equip?.category;
  if (goodType === undefined || category === undefined) return;
  ensureEquipment(world, e);
  const slot = category === 'misc' ? world.get(e, Equipment).misc.indexOf(null) : 0;
  if (slot < 0) return;
  writeEquipSlot(world, e, category, slot, { goodType, degreeOfUse: ZERO });
}

/**
 * Swap the soldier's weapon `from` for a fresh `to` and take it up as a soldier equipping it at a store
 * does: the trade that weapon arms and the combat weapon follow. The old weapon is gone. A trade the
 * script locks keeps its weapon. The soldier keeps the stance and anchor it had, so a guard stays posted.
 */
function upgradeWeapon(world: World, ctx: SystemContext, e: Entity, upgrade: WeaponUpgrade): void {
  const index = contentIndex(ctx.content);
  const from = index.goodTypeBySlug.get(upgrade.from);
  const to = index.goodTypeBySlug.get(upgrade.to);
  if (from === undefined || to === undefined || carriedWeapon(world, ctx, e) !== from) return;
  if (!weaponKeepsLockedJob(world, ctx.content, e, to)) return;
  const stance = world.tryGet(e, Stance);
  const kept = stance === undefined ? undefined : { mode: stance.mode, anchorCell: stance.anchorCell };
  ensureEquipment(world, e);
  writeEquipSlot(world, e, 'weapon', 0, { goodType: to, degreeOfUse: ZERO });
  takeUpWeaponGood(world, ctx, e, to);
  const now = world.tryGet(e, Stance);
  if (kept === undefined || now === undefined) return;
  if (now.mode === kept.mode && now.anchorCell === kept.anchorCell) return;
  const live = world.mut(e, Stance);
  live.mode = kept.mode;
  live.anchorCell = kept.anchorCell;
}

/** The weapon good the soldier carries: its weapon slot, else its class's own weapon. */
function carriedWeapon(world: World, ctx: SystemContext, e: Entity): number | undefined {
  const worn = world.tryGet(e, Equipment)?.weapon?.goodType;
  if (worn !== undefined) return worn;
  const settler = world.get(e, Settler);
  if (settler.jobType === null) return undefined;
  return contentIndex(ctx.content).weaponsByTribeAndJob.get(settler.tribe)?.get(settler.jobType)?.goodType;
}
