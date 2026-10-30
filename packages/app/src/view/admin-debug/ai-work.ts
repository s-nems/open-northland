import type { ContentSet } from '@open-northland/data';
import {
  type components,
  type EntitySnapshot,
  entityById,
  type systems,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { technologyName } from '../../game/technology.js';
import type { AdminAiTable } from '../../hud/dom/admin-panel/model.js';
import { formatMessage, type Messages } from '../../i18n/index.js';

/** What an operation aims at: a place, a named building or trade, or a unit the content does not name. */
export type OperationAim =
  | { readonly kind: 'place' }
  | { readonly kind: 'unit' }
  | { readonly kind: 'named'; readonly label: string };

/** One of the seat's operations as the saved record holds it; an ended one stays until the next decision. */
export interface SeatOperation {
  readonly id: number;
  readonly kind: components.OperationKind;
  readonly state: components.OperationState;
  readonly men: number;
  readonly aim: OperationAim;
  readonly owner: number | null;
  readonly hx: number;
  readonly hy: number;
  /** A hold's radius around its node in map points; null for another kind. */
  readonly range: number | null;
  readonly inStateTicks: number;
  readonly reason: components.OperationEndReason | null;
}

/** One discovery the seat earns ahead of time, its labels resolved. */
export interface SeatApprentice {
  readonly discovery: string;
  /** The building or collector good of the build step that asked for it. */
  readonly opens: string;
  /** The pinned man's id, null while none earns it. */
  readonly man: number | null;
  /** The pinned man's trade, null without a man. */
  readonly trade: string | null;
  readonly repeats: number;
}

/** What a computer seat is doing now: its operations and its apprentices. */
export interface SeatWork {
  readonly operations: readonly SeatOperation[];
  /** Null until the sim answered the read. */
  readonly apprentices: readonly SeatApprentice[] | null;
}

export const NO_WORK: SeatWork = { operations: [], apprentices: null };

const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
const NO_VALUE = '-';

/** The seat's operations off its `AiControl` carrier and its apprentices from the sim's answer. */
export function readSeatWork(
  snapshot: WorldSnapshot,
  carrier: EntitySnapshot,
  content: ContentSet | null,
  apprentices: readonly systems.ApprenticeView[] | undefined,
): SeatWork {
  const held = carrier.components.ComputerOperations as components.ComputerOperationsState | undefined;
  return {
    operations: (held?.operations ?? []).map((op) => ({
      id: op.id,
      kind: op.kind,
      state: op.state,
      men: op.members.length,
      aim: aimOf(snapshot, content, op.target.entity),
      owner: op.target.owner,
      hx: op.target.hx,
      hy: op.target.hy,
      range: op.kind === 'hold' ? op.range : null,
      inStateTicks: snapshot.tick - op.since,
      reason: op.reason,
    })),
    apprentices:
      apprentices === undefined ? null : apprentices.map((a) => apprenticeOf(snapshot, content, a)),
  };
}

function aimOf(snapshot: WorldSnapshot, content: ContentSet | null, target: number | null): OperationAim {
  if (target === null) return { kind: 'place' };
  const e = entityById(snapshot, target);
  const building = (e?.components.Building as { buildingType?: unknown } | undefined)?.buildingType;
  const job = (e?.components.Settler as { jobType?: unknown } | undefined)?.jobType;
  const label =
    content === null
      ? undefined
      : typeof building === 'number'
        ? technologyName(content, 'house', building)
        : typeof job === 'number'
          ? technologyName(content, 'job', job)
          : undefined;
  return label === undefined ? { kind: 'unit' } : { kind: 'named', label };
}

function apprenticeOf(
  snapshot: WorldSnapshot,
  content: ContentSet | null,
  view: systems.ApprenticeView,
): SeatApprentice {
  const job =
    view.man === null
      ? undefined
      : (entityById(snapshot, view.man)?.components.Settler as { jobType?: unknown } | undefined)?.jobType;
  return {
    discovery:
      (content === null ? undefined : technologyName(content, view.kind, view.typeId)) ?? String(view.typeId),
    opens: (content === null ? undefined : opensLabel(content, view.opens)) ?? view.opens,
    man: view.man,
    trade:
      typeof job !== 'number'
        ? null
        : ((content === null ? undefined : technologyName(content, 'job', job)) ?? String(job)),
    repeats: view.repeats,
  };
}

/** A build step's building or good content id as the catalog names it. */
function opensLabel(content: ContentSet, id: string): string | undefined {
  const building = content.buildings.find((b) => b.id === id);
  if (building !== undefined) return technologyName(content, 'house', building.typeId);
  const good = content.goods.find((g) => g.id === id);
  return good === undefined ? undefined : technologyName(content, 'good', good.typeId);
}

/** The operations table, then the apprentices table, each only when it has rows. Codes show raw. */
export function workTables(work: SeatWork, msgs: Messages): AdminAiTable[] {
  const copy = msgs.admin.ai;
  const tables: AdminAiTable[] = [];
  if (work.operations.length > 0) {
    const aim = (a: OperationAim): string =>
      a.kind === 'place' ? copy.place : a.kind === 'unit' ? copy.unit : a.label;
    tables.push({
      head: [
        copy.operation,
        copy.opState,
        copy.men,
        copy.target,
        copy.owner,
        copy.node,
        copy.inState,
        copy.reason,
      ],
      rows: work.operations.map((op) => [
        `#${op.id} ${op.kind}`,
        op.state,
        String(op.men),
        aim(op.aim),
        op.owner === null ? NO_VALUE : formatMessage(copy.player, { player: op.owner }),
        op.range === null ? `${op.hx},${op.hy}` : `${op.hx},${op.hy} r${op.range}`,
        (op.inStateTicks / TICKS_PER_MINUTE).toFixed(1),
        op.reason ?? NO_VALUE,
      ]),
    });
  }
  if (work.apprentices !== null && work.apprentices.length > 0) {
    tables.push({
      head: [copy.discovery, copy.forStep, copy.apprentice, copy.repeats],
      rows: work.apprentices.map((a) => [
        a.discovery,
        a.opens,
        a.man === null ? NO_VALUE : `#${a.man} ${a.trade ?? ''}`.trim(),
        String(a.repeats),
      ]),
    });
  }
  return tables;
}
