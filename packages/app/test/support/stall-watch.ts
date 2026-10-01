import type { Entity, Simulation } from '@open-northland/sim';
import { HUMAN_PLAYER } from '../../src/game/rules.js';
import { createMessageFeed, takeRaised } from '../../src/hud/tool-panel/messages/feed.js';
import { FightAreas } from '../../src/hud/tool-panel/messages/fight-areas.js';
import {
  createSnapshotMessageSource,
  SNAPSHOT_SWEEP_INTERVAL_TICKS,
} from '../../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageNaming } from '../../src/hud/tool-panel/messages/raise.js';
import { NoteRetirement } from '../../src/hud/tool-panel/messages/retire.js';
import {
  type ProductionStall,
  USER_MESSAGE_TYPE,
  type UserMessage,
} from '../../src/hud/tool-panel/messages/types.js';

const naming: MessageNaming = {
  settler: (e) => ({ name: `S${e.id}`, jobLabel: null, female: false }),
  building: () => 'Warsztat',
  vehicle: () => 'Wóz',
  player: () => 'Gracz',
  stance: (state) => state,
  paper: (paper) => `${paper.kind}:${paper.param}`,
  technology: (kind, typeId) => `${kind}:${typeId}`,
  text: (type) => ({ short: String(type), full: String(type) }),
};

/** One stretch of a watched run: every stall note raised meanwhile, the ones standing after, and every
 *  idle note standing after. */
export interface StallWatchRun {
  readonly raised: readonly ProductionStall[];
  readonly standing: readonly UserMessage[];
  readonly idle: readonly UserMessage[];
}

/**
 * The human seat's stall and idle notes over a headless run, in the message centre's raise, feed and retire
 * order, with the sim's own diagnosis answering every ask at once.
 */
export function watchStalls(sim: Simulation): { run(sweeps: number): StallWatchRun } {
  const source = createSnapshotMessageSource(HUMAN_PLAYER, {
    types: sim.content.buildings.filter((b) => b.recipes.length > 0).map((b) => b.typeId),
    workStatus: (entity, asked) => ({ status: sim.workStatus(entity as Entity), asked }),
  });
  const retirement = new NoteRetirement(new FightAreas(), source.stalls);
  const feed = createMessageFeed();
  return {
    run(sweeps) {
      const raised: ProductionStall[] = [];
      for (let i = 0; i < sweeps; i++) {
        sim.run(SNAPSHOT_SWEEP_INTERVAL_TICKS);
        const snapshot = sim.snapshot();
        for (const r of source.sweep(snapshot, naming)) {
          if (r.pending.stall !== null && r.pending.stall !== undefined) raised.push(r.pending.stall);
          takeRaised(feed, r, snapshot.tick);
        }
        feed.expire(snapshot.tick, (m) => retirement.isOver(m, snapshot));
        retirement.endPass();
      }
      const live = feed.live();
      return {
        raised,
        standing: live.filter((m) => m.type === USER_MESSAGE_TYPE.productionStalled),
        idle: live.filter((m) => m.type === USER_MESSAGE_TYPE.nothingToDo),
      };
    },
  };
}
