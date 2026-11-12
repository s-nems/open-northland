import { systems } from '@open-northland/sim';
import { healthOf, num, type SnapshotEntity } from '../../../game/snapshot/index.js';
import { pctRatio } from './bars.js';
import { liveAmounts } from './building-materials.js';
import type { TempleBlessing } from './building-status.js';
import { type BuildingDef, goodDef, goodLabel, type UnitPanelModelContext } from './context.js';

/** A temple's holy fire: the unit of oil burning now and how much of it is left. */
export interface TempleFireModel {
  readonly goodId?: string;
  readonly label: string;
  /** Share of the burning unit still to burn, 0..100; 0 with none stored. */
  readonly pct: number;
  /** Game seconds the burning unit still lasts, 0 with none stored. */
  readonly unitSecondsLeft: number;
  /** Game seconds the whole store still burns. */
  readonly storeSecondsLeft: number;
  /** Whether it burns now; a wounded temple holds its unit unburned. */
  readonly burning: boolean;
  /** Whether the owner put the fire out. */
  readonly doused: boolean;
}

interface FireState {
  readonly burnedSeconds: number;
  readonly blessing: boolean;
  readonly doused: boolean;
}

function fireOf(ent: SnapshotEntity): FireState | null {
  const fire = ent.components.TempleFire as
    | { burnedSeconds?: unknown; blessing?: unknown; doused?: unknown }
    | undefined;
  if (fire === undefined) return null;
  return {
    burnedSeconds: num(fire.burnedSeconds) ?? 0,
    blessing: fire.blessing === true,
    doused: fire.doused === true,
  };
}

/** The good a temple burns, undefined for a house that burns none. */
function templeFuelOf(def: BuildingDef | undefined): number | undefined {
  return def?.prayerSite === 'temple' ? def.stock[0]?.goodType : undefined;
}

/** A temple's blessing off its `TempleFire`: on with the oil it holds still to burn, else out for a fire
 *  its owner put out, a wound or want of oil. Null for any house the sim keeps no temple fire on. */
export function templeBlessing(def: BuildingDef | undefined, ent: SnapshotEntity): TempleBlessing | null {
  const fire = fireOf(ent);
  if (fire === null) return null;
  if (!fire.blessing) {
    if (fire.doused) return { state: 'doused' };
    const health = healthOf(ent);
    return { state: health !== undefined && health.hitpoints < health.max ? 'damaged' : 'no-oil' };
  }
  const fuel = templeFuelOf(def);
  if (fuel === undefined) return { state: 'on', secondsLeft: null };
  const units = liveAmounts(ent.components.Stockpile).get(fuel) ?? 0;
  return { state: 'on', secondsLeft: units * systems.TEMPLE_FUEL_BURN_SECONDS - fire.burnedSeconds };
}

/** The burning unit of a temple that burns fuel; null for any other house and a scripted seat's temple,
 *  which blesses on an empty store. */
export function templeFireModel(
  ctx: Pick<UnitPanelModelContext, 'goods'>,
  def: BuildingDef | undefined,
  ent: SnapshotEntity,
): TempleFireModel | null {
  const fire = fireOf(ent);
  const fuel = templeFuelOf(def);
  if (fire === null || fuel === undefined) return null;
  const units = liveAmounts(ent.components.Stockpile).get(fuel) ?? 0;
  if (units <= 0 && fire.blessing) return null;
  const burnTime = systems.TEMPLE_FUEL_BURN_SECONDS;
  const unitSecondsLeft = units > 0 ? Math.max(0, burnTime - fire.burnedSeconds) : 0;
  const goodId = goodDef(ctx, fuel)?.id;
  return {
    ...(goodId !== undefined ? { goodId } : {}),
    label: goodLabel(ctx, fuel),
    pct: pctRatio(unitSecondsLeft, burnTime),
    unitSecondsLeft,
    storeSecondsLeft: Math.max(0, units * burnTime - fire.burnedSeconds),
    burning: fire.blessing,
    doused: fire.doused,
  };
}
