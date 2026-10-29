import type { JobRequirementTarget } from '@open-northland/data';
import { playerPlacementTribes, professionProgressionEnabled } from '../../../components/index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled, goodEnabled, jobEnabled, typeAllowed } from '../../progression/index.js';
import { anyLiveResource, knownResourceTest } from '../live-resources.js';
import { seatHuntsGame } from '../workforce/hunter.js';
import {
  type CreditedTrack,
  type DiscoveryGate,
  type TechnologyTable,
  technologyTable,
} from './requirements.js';

/**
 * Whether a seat could ever discover a house, job or good it lacks: every gate on the way is allowed for
 * it (`typeAllowed`, so a map or script ban closes it), reached by a trade it could hold, and credited by
 * work the map still offers (a live resource or a field a workshop of the trade plants, game for the
 * hunter, a workshop the seat may raise). Answers are kept for one decision, since a resource running dry
 * or a script ban changes them.
 */
export class TechnologyReach {
  private readonly verdicts = new Map<string, boolean>();
  private readonly live = new Map<number, boolean>();
  private hunts: boolean | undefined;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly player: number,
    private readonly tribe: number,
    private readonly table: TechnologyTable,
  ) {}

  house(typeId: number): boolean {
    return this.memo(`house:${typeId}`, () => {
      if (!typeAllowed(this.world, this.ctx, this.player, this.tribe, 'house', typeId)) return false;
      if (buildingEnabled(this.world, this.ctx, this.player, this.tribe, typeId)) return true;
      const row = this.table.houses.get(typeId);
      if (row === undefined) return true;
      return row.jobs.every((gate) => this.gate(gate)) && row.goods.every((gate) => this.gate(gate));
    });
  }

  target(kind: JobRequirementTarget, typeId: number): boolean {
    const gate = (kind === 'job' ? this.table.jobs : this.table.goods).get(typeId);
    if (gate !== undefined) return this.gate(gate);
    return typeAllowed(this.world, this.ctx, this.player, this.tribe, kind, typeId);
  }

  private gate(gate: DiscoveryGate): boolean {
    return this.memo(`${gate.kind}:${gate.typeId}`, () => {
      const { world, ctx, player, tribe } = this;
      if (!typeAllowed(world, ctx, player, tribe, gate.kind, gate.typeId)) return false;
      const enabled = gate.kind === 'job' ? jobEnabled : goodEnabled;
      if (enabled(world, ctx, player, tribe, gate.typeId)) return true;
      if (!gate.enablingJobs.some((job) => this.target('job', job))) return false;
      return gate.needs.every((row) => row.tracks.some((track) => this.credited(track)));
    });
  }

  private credited(track: CreditedTrack): boolean {
    if (track.job === null || !this.target('job', track.job)) return false;
    const { work } = track;
    switch (work.kind) {
      case 'hunt':
        this.hunts ??= seatHuntsGame(this.world, this.ctx, this.player);
        return this.hunts;
      case 'gather':
        return (
          work.workshops.some((house) => this.house(house)) ||
          (work.goods.length === 0
            ? true
            : work.goods.some((good) => this.target('good', good) && this.liveResource(good)))
        );
      case 'craft':
        return work.workshops.some((house) => this.house(house));
      case 'other':
        return true;
    }
  }

  private liveResource(good: number): boolean {
    let known = this.live.get(good);
    if (known === undefined) {
      known = anyLiveResource(this.world, good, knownResourceTest(this.world, this.ctx, this.player));
      this.live.set(good, known);
    }
    return known;
  }

  /** `compute`'s verdict under `key`, false while it is being computed so a cycle in content reads as
   *  unreachable instead of recursing. */
  private memo(key: string, compute: () => boolean): boolean {
    const known = this.verdicts.get(key);
    if (known !== undefined) return known;
    this.verdicts.set(key, false);
    const verdict = compute();
    this.verdicts.set(key, verdict);
    return verdict;
  }
}

const reaches = new WeakMap<object, Map<number, TechnologyReach | null>>();

/**
 * The seat's {@link TechnologyReach} for the decision `decision` stands for, or null while nothing is
 * gated: the match's progression toggle off, or a seat whose placement tribe has no technology table.
 */
export function technologyReach(
  world: World,
  ctx: SystemContext,
  player: number,
  decision: object,
): TechnologyReach | null {
  let bySeat = reaches.get(decision);
  if (bySeat === undefined) {
    bySeat = new Map();
    reaches.set(decision, bySeat);
  }
  if (bySeat.has(player)) return bySeat.get(player) ?? null;
  const tribe = playerPlacementTribes(world, player)?.[0];
  const table =
    tribe === undefined || !professionProgressionEnabled(world) ? null : technologyTable(ctx.content, tribe);
  const reach =
    tribe === undefined || table === null ? null : new TechnologyReach(world, ctx, player, tribe, table);
  bySeat.set(player, reach);
  return reach;
}
