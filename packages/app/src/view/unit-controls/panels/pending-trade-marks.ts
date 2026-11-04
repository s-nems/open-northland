import {
  type Entity,
  type PlayerCommand,
  TICKS_PER_SECOND,
  TRADE_LIMIT_NONE,
  type TradeImportMark,
  type TraderView,
  type TradeStopView,
} from '@open-northland/sim';

/** Ticks a mark the sim never confirms keeps showing: longer than a relayed session's input delay, short
 *  enough that a refused press snaps back soon. Game ticks, so a paused session holds it. */
const PENDING_TICKS = TICKS_PER_SECOND * 2;

interface Pending {
  readonly trader: number;
  readonly house: number;
  readonly good: number;
  /** The mark is set or cleared; absent leaves it as the live route has it. */
  on?: boolean;
  limits?: { readonly upTo: number; readonly keep: number };
  /** The session tick the last press was issued on. */
  issued: number;
}

/**
 * The trade marks the player pressed and the sim has not answered yet, laid over the live route so the
 * trade window paints a press in the frame it was made. The sim's own rules (`setTradeImport`,
 * `setTradeImportLimits`) decide; a press it refuses shows until `PENDING_TICKS` pass.
 */
export interface PendingTradeMarks {
  /** Record a command the panels issue on `tick`; any other command is ignored. */
  record(command: PlayerCommand, tick: number): void;
  /** The trader's route with its pending marks applied, the live object itself when none is pending. */
  view(trader: number, live: TraderView | undefined, tick: number): TraderView | undefined;
}

export function createPendingTradeMarks(): PendingTradeMarks {
  const pending = new Map<string, Pending>();
  const entry = (trader: Entity, house: Entity, good: number, tick: number): Pending => {
    const key = `${trader}:${house}:${good}`;
    const held = pending.get(key) ?? { trader, house, good, issued: tick };
    held.issued = tick;
    pending.set(key, held);
    return held;
  };

  const shows = (stop: TradeStopView, mark: Pending): boolean => {
    const live = stop.imports.find((candidate) => candidate.good === mark.good);
    if (mark.on !== undefined && (live !== undefined) !== mark.on) return false;
    return (
      mark.limits === undefined ||
      live === undefined ||
      (live.upTo === mark.limits.upTo && live.keep === mark.limits.keep)
    );
  };

  const applied = (imports: readonly TradeImportMark[], mark: Pending): readonly TradeImportMark[] => {
    let next = imports;
    const has = next.some((candidate) => candidate.good === mark.good);
    if (mark.on === true && !has) {
      next = [...next, { good: mark.good, upTo: TRADE_LIMIT_NONE, keep: TRADE_LIMIT_NONE }].sort(
        (a, b) => a.good - b.good,
      );
    } else if (mark.on === false && has) {
      next = next.filter((candidate) => candidate.good !== mark.good);
    }
    const limits = mark.limits;
    return limits === undefined
      ? next
      : next.map((candidate) => (candidate.good === mark.good ? { ...candidate, ...limits } : candidate));
  };

  return {
    record(command, tick): void {
      if (command.kind === 'setTradeImport') {
        const mark = entry(command.entity, command.house, command.good, tick);
        mark.on = command.on;
        delete mark.limits;
      } else if (command.kind === 'setTradeImportLimits') {
        entry(command.entity, command.house, command.good, tick).limits = {
          upTo: command.upTo,
          keep: command.keep,
        };
      }
    },
    view(trader, live, tick): TraderView | undefined {
      if (live === undefined || pending.size === 0) return live;
      let stops = live.stops;
      for (const [key, mark] of pending) {
        if (mark.trader !== trader) continue;
        const at = stops.findIndex((stop) => stop.house === mark.house);
        const stop = stops[at];
        // A route the sim answered after the press, or a press it never took, needs no overlay.
        const answered = tick > mark.issued && stop !== undefined && shows(stop, mark);
        if (stop === undefined || answered || tick - mark.issued > PENDING_TICKS) {
          pending.delete(key);
          continue;
        }
        const imports = applied(stop.imports, mark);
        if (imports !== stop.imports) stops = stops.map((s, i) => (i === at ? { ...s, imports } : s));
      }
      return stops === live.stops ? live : { ...live, stops };
    },
  };
}
