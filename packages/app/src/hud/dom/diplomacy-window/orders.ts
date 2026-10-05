import { type DiplomacyState, TICKS_PER_SECOND } from '@open-northland/sim';
import type { DiplomacyPanelRow, DiplomacySource } from './model.js';

interface Pending {
  readonly player: number;
  readonly state?: DiplomacyState;
  readonly slot?: number;
  submitted: number | null;
}

/** Tick time preserves a submitted order while paused. The live state confirms it; a request
 *  accepted by the UI may still be refused when the simulation applies it. */
const RESULT_TICKS = TICKS_PER_SECOND * 3;

export class DiplomacyOrders {
  private readonly pending = new Map<string, Pending>();
  private viewer: number | null;
  failed = false;

  constructor(
    private readonly source: DiplomacySource,
    private readonly changed: () => void,
  ) {
    this.viewer = source.viewer();
  }

  stance(row: DiplomacyPanelRow): DiplomacyState {
    return this.pending.get(`stance:${row.player}`)?.state ?? row.yourStance;
  }

  declaring(player: number): boolean {
    return this.pending.has(`stance:${player}`);
  }
  paying(slot: number): boolean {
    return this.pending.has(`pay:${slot}`);
  }

  declare(row: DiplomacyPanelRow, state: DiplomacyState): void {
    if (!row.canDeclare || row.yourStance === state || this.declaring(row.player)) return;
    this.send(`stance:${row.player}`, { player: row.player, state, submitted: null }, () =>
      this.source.declare(row.player, state),
    );
  }

  pay(row: DiplomacyPanelRow, slot: number): void {
    if (this.paying(slot) || !row.tributes.some((t) => t.slot === slot && t.payable)) return;
    this.send(`pay:${slot}`, { player: row.player, slot, submitted: null }, () =>
      this.source.pay(row.player, slot),
    );
  }

  reconcile(rows: readonly DiplomacyPanelRow[]): void {
    if (this.viewer !== this.source.viewer()) {
      this.clear();
      this.viewer = this.source.viewer();
    }
    for (const [key, request] of this.pending) {
      const row = rows.find((r) => r.player === request.player);
      if (
        row === undefined ||
        (request.state !== undefined
          ? row.yourStance === request.state
          : !row.tributes.some((t) => t.slot === request.slot))
      ) {
        this.pending.delete(key);
      } else if (request.submitted !== null && this.source.tick() - request.submitted >= RESULT_TICKS) {
        this.pending.delete(key);
        this.failed = true;
      }
    }
  }

  clear(): void {
    this.pending.clear();
    this.failed = false;
  }

  private send(key: string, request: Pending, submit: () => Promise<boolean>): void {
    this.failed = false;
    this.pending.set(key, request);
    this.changed();
    void submit()
      .catch(() => false)
      .then((accepted) => {
        if (this.pending.get(key) !== request || this.viewer !== this.source.viewer()) return;
        if (accepted) request.submitted = this.source.tick();
        else {
          this.pending.delete(key);
          this.failed = true;
        }
        this.changed();
      });
  }
}
