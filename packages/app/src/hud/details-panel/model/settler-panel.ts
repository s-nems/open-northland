import { systems, type WorldSnapshot } from '@open-northland/sim';
import {
  isPlayerControllable,
  needsRuleEnabled,
  num,
  ownerPlayerOf,
  progressionGatesSettler,
  regeneratesInWorld,
  type SnapshotEntity,
  settlerJobType,
  stanceModeOf,
} from '../../../game/snapshot.js';
import { pickableSeat } from '../../../game/viewer-seat.js';
import { formatMessage, messages, tribeName } from '../../../i18n/index.js';
import type { PanelBar } from './bars.js';
import {
  type Comp,
  contentTribeName,
  goodDef,
  goodLabel,
  jobDisplayName,
  type UnitPanelModelContext,
} from './context.js';
import {
  type ExperienceRowModel,
  experienceRows,
  type SettlerState,
  satisfactionBars,
  settlerStatus,
} from './settler.js';
import { type EquipRow, equipmentRows } from './settler-equipment.js';
import {
  familyModel,
  homeRow,
  type SeatControl,
  type SettlerFamilyModel,
  type SettlerRole,
  type SettlerSeatRow,
  type SettlerWorkplaceRow,
  settlerRole,
  workplaceRow,
} from './settler-household.js';
import { settlerDisplayName } from './settler-name.js';
import { type UnlockProgressRowModel, unlockProgressRows } from './settler-unlocks.js';
import { type SettlerProductionModel, type SettlerWorkModel, settlerWork } from './settler-work.js';
import { type TradePanelModel, tradePanelModel } from './trade.js';

/** The good a settler carries, for the status line's "niesie" well. */
export interface CarriedGoodModel {
  readonly goodId?: string;
  readonly label: string;
  readonly amount: number;
}

/** The status line: the live state, its detail after a dot, and what the person carries. */
export interface SettlerStatusModel {
  readonly state: SettlerState;
  readonly label: string;
  readonly detail: string | null;
  /** A tradesman standing idle or waiting for its workshop: the line reads amber. */
  readonly trouble: boolean;
  readonly carrying: CarriedGoodModel | null;
}

export interface SettlerMilitaryModel {
  /** The `MILITARY_MODE`, null before the sim stamped one. */
  readonly stance: number | null;
  /** Whether the soldier leaves its post to eat and sleep (no `NoRegeneration`). */
  readonly regeneration: boolean;
}

/** The selected person's panel (FOUNDATION.md, "Settler panel"). A null section is not shown. */
export interface SettlerPanelModel {
  readonly kind: 'settler';
  readonly entityId: number;
  readonly name: string;
  readonly profession: string;
  /** The trade the kicker browses by; null for a person without one. */
  readonly jobType: number | null;
  readonly role: SettlerRole;
  /** Another seat's person: trade, name, owner line, state, health and workplace, no controls. */
  readonly foreign: boolean;
  readonly renamable: boolean;
  /** The owner line: another seat's owner and stance, or a child's age; null when it says nothing. */
  readonly meta: string | null;
  readonly status: SettlerStatusModel;
  /** Zdrowie, then the need bars the person carries. */
  readonly bars: readonly PanelBar[];
  readonly workplace: SettlerWorkplaceRow | null;
  readonly home: SettlerSeatRow | null;
  readonly family: SettlerFamilyModel | null;
  readonly production: SettlerProductionModel | null;
  readonly military: SettlerMilitaryModel | null;
  readonly trade: TradePanelModel | null;
  /** The current trade's tracks first; empty for a person the panel shows none. */
  readonly experience: readonly ExperienceRowModel[];
  readonly upcomingUnlocks: readonly UnlockProgressRowModel[];
  /** The equipment rows, empty for a woman, a child and another seat's person. */
  readonly equipmentRows: readonly EquipRow[];
}

function metaLine(
  ctx: UnitPanelModelContext,
  ent: SnapshotEntity,
  foreign: boolean,
  role: SettlerRole,
): string | null {
  const copy = messages().hud;
  if (foreign) {
    const owner = ownerPlayerOf(ent);
    const tribeId = num((ent.components.Settler as { tribe?: unknown } | undefined)?.tribe);
    const values = { player: owner ?? '-', tribe: tribeName(tribeId, contentTribeName(ctx, tribeId)) };
    const stance = owner === undefined ? undefined : ctx.diplomacyStance?.(owner);
    return stance === undefined
      ? formatMessage(copy.settlerPanel.foreignOwnerPlain, values)
      : formatMessage(copy.settlerPanel.foreignOwner, { ...values, stance: copy.diplomacyStances[stance] });
  }
  if (role !== 'child') return null;
  // `Age` is the sim's marker for a settler still growing up, dropped at adulthood.
  const ageTicks = num((ent.components.Age as { ticks?: unknown } | undefined)?.ticks);
  return ageTicks === undefined
    ? null
    : formatMessage(copy.age, { years: Math.floor(ageTicks / systems.TICKS_PER_AGE_YEAR) });
}

function carriedGood(ctx: UnitPanelModelContext, comps: Comp): CarriedGoodModel | null {
  const carry = comps.Carrying as { goodType?: unknown; amount?: unknown } | undefined;
  const goodType = num(carry?.goodType);
  if (goodType === undefined) return null;
  const id = goodDef(ctx, goodType)?.id;
  return {
    label: goodLabel(ctx, goodType),
    amount: num(carry?.amount) ?? 0,
    ...(id !== undefined ? { goodId: id } : {}),
  };
}

/**
 * The detail after the state's dot: a lesson's progress, a trader's destination, the product being
 * made, or the reason a tradesman stands idle. The product and the idle reason are the sim's
 * `workStatus` reading for the settler's workplace.
 */
function statusDetail(
  ctx: UnitPanelModelContext,
  entityId: number,
  state: SettlerState,
  role: SettlerRole,
  work: SettlerWorkModel,
  trade: TradePanelModel | null,
): string | null {
  const copy = messages().hud.settlerPanel;
  if (work.lesson !== null) return work.lesson;
  if (trade !== null && state === 'walking' && trade.destination !== null) {
    return formatMessage(copy.towards, { place: trade.destination });
  }
  const idle = state === 'idle' || state === 'awaitingWorkplace';
  const status = ctx.workStatus?.(entityId);
  if (status === undefined) return idle && role === 'civilian' ? copy.idleReasons.noJob : null;
  switch (status.kind) {
    case 'crafting':
      return state === 'working' ? goodLabel(ctx, status.goodType) : null;
    case 'waitingInput':
      return idle
        ? formatMessage(copy.idleReasons.waitingInput, { good: goodLabel(ctx, status.goodType) })
        : null;
    case 'outputFull':
    case 'nothingSelected':
    case 'noTool':
    case 'noJob':
      return idle ? copy.idleReasons[status.kind] : null;
    case 'workplaceUnderConstruction':
      return null;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function settlerPanelModel(
  ctx: UnitPanelModelContext,
  snapshot: WorldSnapshot,
  ent: SnapshotEntity,
): SettlerPanelModel {
  const comps = ent.components as Comp;
  const jobType = settlerJobType(ent);
  const role = settlerRole(ctx, ent);
  const seat = ctx.viewer === undefined ? null : pickableSeat(ctx.viewer);
  const owner = ownerPlayerOf(ent);
  // Another seat's person; an ownerless one (a scene's stray) is nobody else's.
  const foreign = seat !== null && owner !== undefined && owner !== seat;
  const controllable = !foreign && isPlayerControllable(ent);
  const control: SeatControl = controllable ? true : messages().hud.settlerPanel.scripted;
  const progressionGated = progressionGatesSettler(snapshot, ent);
  const work = settlerWork(ctx, snapshot, comps, progressionGated);
  const trade = foreign ? null : tradePanelModel(ctx, snapshot, ent.id);
  const state = settlerStatus(ctx, snapshot, ent.id, comps);
  const status: SettlerStatusModel = {
    state,
    label: messages().hud.statuses[state],
    detail: statusDetail(ctx, ent.id, state, role, work, trade),
    trouble:
      (state === 'idle' || state === 'awaitingWorkplace') && (role === 'worker' || role === 'civilian'),
    carrying: carriedGood(ctx, comps),
  };
  const hero = role === 'hero';
  const bars = satisfactionBars(ent, needsRuleEnabled(snapshot) && !foreign, !hero);
  const base = {
    kind: 'settler' as const,
    entityId: ent.id,
    name: settlerDisplayName(ctx, snapshot, ent),
    profession: jobDisplayName(ctx, jobType),
    jobType: jobType ?? null,
    role,
    foreign,
    meta: metaLine(ctx, ent, foreign, role),
    status,
    bars,
  };
  if (foreign) {
    return {
      ...base,
      renamable: false,
      workplace: work.place === null ? null : { target: work.place, assign: null, remove: null, flag: false },
      home: null,
      family: null,
      production: null,
      military: null,
      trade: null,
      experience: [],
      upcomingUnlocks: [],
      equipmentRows: [],
    };
  }
  // A woman and a child hold no trade to train in.
  const trains = role !== 'woman' && role !== 'child';
  return {
    ...base,
    renamable: !hero,
    workplace: role === 'worker' ? workplaceRow(ctx, ent, work.place, control) : null,
    home: homeRow(ctx, snapshot, ent, role, control),
    family: familyModel(ctx, snapshot, ent, role, controllable),
    production: work.production,
    military:
      role === 'soldier' || hero
        ? { stance: stanceModeOf(ent) ?? null, regeneration: regeneratesInWorld(ent) }
        : null,
    trade,
    experience: trains ? experienceRows(ctx, comps) : [],
    upcomingUnlocks: trains ? unlockProgressRows(ctx, comps, progressionGated) : [],
    equipmentRows: equipmentRows(ctx, comps),
  };
}
