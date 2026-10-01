import { NeedOrder, SettlerNeeds } from '../../../components/index.js';
import type { Fixed } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { draughtFor, spendSip } from '../../equipment/index.js';
import { mutNeeds, needLevel } from './levels.js';
import { applyNeedUnits, NEED_DRIVE_THRESHOLD, NEED_RESERVE_UNITS } from './scale.js';
import { carriesNeeds } from './system.js';

/** A restore percent in need reserve units. */
const reserveUnits = (pct: number): number => (pct * NEED_RESERVE_UNITS) / 100;

const pressing = (level: Fixed): boolean => level >= NEED_DRIVE_THRESHOLD;

/**
 * Drink one carried draught for each of hunger and fatigue whose bar is at the drive level, hunger first,
 * where the settler stands and without stopping what it does. A sip restores every bar its good names, so
 * mead drunk for hunger also rests. Original behavior: checked whenever the settler plans and at every
 * node it walks onto, before any other answer to the need, and never while a player's need order is
 * pending.
 */
export function drinkPressingDraughts(world: World, ctx: SystemContext, e: Entity): void {
  const bars = world.tryGet(e, SettlerNeeds);
  if (
    bars === undefined ||
    !(pressing(needLevel(bars, 'hunger', ctx.tick)) || pressing(needLevel(bars, 'fatigue', ctx.tick)))
  )
    return;
  if (world.has(e, NeedOrder) || !carriesNeeds(world, ctx.content, e)) return;
  for (const need of ['hunger', 'fatigue'] as const) {
    if (!pressing(needLevel(world.get(e, SettlerNeeds), need, ctx.tick))) continue;
    const draught = draughtFor(world, ctx, e, need);
    if (draught === null) continue;
    const s = mutNeeds(world, e, ctx.tick);
    const { hunger, fatigue } = draught.restore;
    if (hunger !== undefined) s.hunger = applyNeedUnits(s.hunger, reserveUnits(hunger));
    if (fatigue !== undefined) s.fatigue = applyNeedUnits(s.fatigue, reserveUnits(fatigue));
    spendSip(world, ctx, e, draught.slot);
  }
}
