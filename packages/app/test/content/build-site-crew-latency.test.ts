import { existsSync } from 'node:fs';
import {
  components,
  type Entity,
  nodeOfPosition,
  playerCommand,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapWorld } from './real-map-world.js';

const {
  Building,
  Chat,
  CurrentAtomic,
  MoveGoal,
  Owner,
  Position,
  Settler,
  SiteAssignment,
  SupplyRun,
  UnderConstruction,
} = components;

const MAP_ID = 'magiczny_las';
const HUMAN_SEAT = 0;
/** Long enough for the seat's idle builders to have paired off into chatter before the order arrives. */
const IDLE_TICKS = 50;
/** The command's tick, then one idle re-plan period for every idle builder to see the new site. */
const CREW_TICKS = 1 + systems.IDLE_REPLAN_PERIOD_TICKS;
/** Half-cell nodes scanned around the headquarters for legal ground. */
const PLOT_SEARCH_NODES = 16;

/**
 * A placed foundation must draw its crew within an idle re-plan period: the reported failure was builders
 * chatting idly for hundreds of ticks after the order while the site stood empty.
 */
describe.runIf(hasRealIr() && existsSync(realMapPath(MAP_ID)))(
  'construction crew latency on a decoded map',
  () => {
    it('idle builders leave their chatter for a new site within a planner pass', {
      timeout: 120_000,
    }, async () => {
      // Progression off: the seat's first house waits on a discovered good otherwise, and the crew's
      // latency is what this measures.
      const { sim, ir } = await realMapWorld({
        mapId: MAP_ID,
        aiSeats: [],
        humanSeats: [HUMAN_SEAT],
        rules: { fog: null, progression: false, needs: null },
      });
      const house = typeIdOf(ir.buildings, 'home_level_00');
      const hqType = typeIdOf(ir.buildings, 'headquarters');
      const builderJob = typeIdOf(ir.jobs, 'builder');
      const hq = [...sim.world.query(Building, Owner)].find(
        (e) =>
          sim.world.get(e, Owner).player === HUMAN_SEAT && sim.world.get(e, Building).buildingType === hqType,
      );
      if (hq === undefined) throw new Error('seat 0 has no headquarters');
      const builders = [...sim.world.query(Settler, Owner)].filter(
        (e) =>
          sim.world.get(e, Owner).player === HUMAN_SEAT && sim.world.get(e, Settler).jobType === builderJob,
      );
      expect(builders.length).toBeGreaterThan(0);

      sim.run(IDLE_TICKS);
      expect(builders.some((b) => sim.world.tryGet(b, Chat)?.kind === 'pastime')).toBe(true);
      const plot = plotNear(sim, hq, house);
      if (plot === null) throw new Error('no legal house plot beside the headquarters');
      sim.enqueue(
        playerCommand(HUMAN_SEAT, {
          kind: 'placeBuilding',
          buildingType: house,
          x: plot.hx,
          y: plot.hy,
          tribe: sim.world.get(hq, Building).tribe,
          underConstruction: true,
        }),
      );
      sim.run(CREW_TICKS);

      const site = [...sim.world.query(Building, UnderConstruction)].find(
        (e) => sim.world.tryGet(e, Owner)?.player === HUMAN_SEAT,
      );
      expect(site).toBeDefined();
      if (site === undefined) throw new Error('placed site was not found');
      const crew = builders.filter((builder) => sim.world.tryGet(builder, SiteAssignment)?.site === site);
      expect(crew.length).toBeGreaterThan(0);
      for (const builder of crew) {
        const atomic = sim.world.tryGet(builder, CurrentAtomic)?.effect;
        const usefulIntent =
          sim.world.tryGet(builder, SupplyRun)?.site === site ||
          (atomic?.kind === 'construct' && atomic.site === site) ||
          sim.world.has(builder, MoveGoal);
        expect(usefulIntent).toBe(true);
        expect(sim.world.tryGet(builder, Chat)?.kind).not.toBe('pastime');
      }
    });
  },
);

/** The served IR's numeric id for a stable content id. */
function typeIdOf(rows: readonly { id?: string; typeId?: number }[] | undefined, id: string): number {
  const typeId = rows?.find((r) => r.id === id)?.typeId;
  if (typeId === undefined) throw new Error(`no ${id} row in the served IR`);
  return typeId;
}

/** The first legal half-cell node for `buildingType` in a square around the headquarters. */
function plotNear(sim: Simulation, hq: Entity, buildingType: number): { hx: number; hy: number } | null {
  const probe = sim.placementProbe(buildingType, HUMAN_SEAT);
  if (probe === null) return null;
  const p = sim.world.get(hq, Position);
  const centre = nodeOfPosition(p.x, p.y);
  for (let dy = -PLOT_SEARCH_NODES; dy <= PLOT_SEARCH_NODES; dy += 2) {
    for (let dx = -PLOT_SEARCH_NODES; dx <= PLOT_SEARCH_NODES; dx += 2) {
      const hx = centre.hx + dx;
      const hy = centre.hy + dy;
      if (probe.canPlace(hx, hy)) return { hx, hy };
    }
  }
  return null;
}
